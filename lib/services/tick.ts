/**
 * tick.ts — Project-level queue scan + dispatch.
 *
 * Core function: projectTick() scans one project's queue and fills free worker slots.
 * Called by: work_finish (next pipeline step), heartbeat service (sweep).
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { RunCommand } from "../context.js";
import type { Issue, IssueProvider } from "../providers/provider.js";
import { createProvider } from "../providers/index.js";
import { normalizeRepoTarget } from "../tools/helpers.js";
import { selectLevel } from "../roles/model-selector.js";
import { getRoleWorker, getProject, readProjects, findFreeSlot, countActiveSlots, reconcileSlots } from "../projects/index.js";
import { dispatchTask } from "../dispatch/index.js";
import { getLevelsForRole } from "../roles/index.js";
import { loadConfig } from "../config/index.js";
import {
  ExecutionMode,
  ReviewPolicy,
  TestPolicy,
  getActiveLabel,
  type WorkflowConfig,
  type Role,
} from "../workflow/index.js";
import { detectRoleLevelFromLabels, detectStepRouting, findNextIssueForRole } from "./queue-scan.js";
import { evaluateLoopBrake, getLoopBrakeHoldLabel, recordLoopBrakeHalt } from "./loop-brake.js";
import { recordLoopDiagnostic } from "./loop-diagnostics.js";

// ---------------------------------------------------------------------------
// projectTick
// ---------------------------------------------------------------------------

export type TickAction = {
  project: string;
  projectSlug: string;
  issueId: number;
  issueTitle: string;
  issueUrl: string;
  role: Role;
  level: string;
  sessionAction: "spawn" | "send";
  announcement: string;
};

export type TickResult = {
  pickups: TickAction[];
  skipped: Array<{ role?: string; reason: string }>;
};

/**
 * Scan one project's queue and fill free worker slots.
 *
 * Does NOT run health checks (that's the heartbeat service's job).
 * Non-destructive: only dispatches if slots are free and issues are queued.
 */
export async function projectTick(opts: {
  workspaceDir: string;
  projectSlug: string;
  agentId?: string;
  sessionKey?: string;
  pluginConfig?: Record<string, unknown>;
  dryRun?: boolean;
  maxPickups?: number;
  /** Only attempt this role. Used by work_finish to fill the next pipeline step. */
  targetRole?: Role;
  /** Optional provider override (for testing). Uses createProvider if omitted. */
  provider?: IssueProvider;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Instance name for ownership filtering and auto-claiming. */
  instanceName?: string;
  /** Injected runCommand for dependency injection. */
  runCommand?: RunCommand;
}): Promise<TickResult> {
  const {
    workspaceDir, projectSlug, agentId, sessionKey, pluginConfig, dryRun,
    maxPickups, targetRole, runtime, instanceName, runCommand,
  } = opts;

  const project = getProject(await readProjects(workspaceDir), projectSlug);
  if (!project) return { pickups: [], skipped: [{ reason: `Project not found: ${projectSlug}` }] };

  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const workflow = opts.workflow ?? resolvedConfig.workflow;

  const provider = opts.provider ?? (await createProvider({
    repo: project.repo,
    provider: project.provider,
    target: project.repoRemote ? { repo: normalizeRepoTarget(project.repoRemote) } : undefined,
    runCommand: runCommand!,
  })).provider;
  const roleExecution = workflow.roleExecution ?? ExecutionMode.PARALLEL;
  const enabledRoles = Object.entries(resolvedConfig.roles)
    .filter(([, r]) => r.enabled)
    .map(([id]) => id);
  const roles: Role[] = targetRole ? [targetRole] : enabledRoles;

  const pickups: TickAction[] = [];
  const skipped: TickResult["skipped"] = [];
  let pickupCount = 0;

  for (const role of roles) {
    if (maxPickups !== undefined && pickupCount >= maxPickups) {
      skipped.push({ role, reason: "Max pickups reached" });
      continue;
    }

    // Re-read fresh state (previous dispatch may have changed it)
    const fresh = getProject(await readProjects(workspaceDir), projectSlug);
    if (!fresh) break;

    const roleWorker = getRoleWorker(fresh, role);
    const levelMaxWorkers = resolvedConfig.roles[role]?.levelMaxWorkers ?? {};
    reconcileSlots(roleWorker, levelMaxWorkers);

    // Check sequential role execution: any other role must be inactive
    const otherRoles = enabledRoles.filter((r: string) => r !== role);
    if (roleExecution === ExecutionMode.SEQUENTIAL && otherRoles.some((r: string) => countActiveSlots(getRoleWorker(fresh, r)) > 0)) {
      skipped.push({ role, reason: "Sequential: other role active" });
      continue;
    }

    // Review policy gate: fallback for issues dispatched before step routing labels existed
    if (role === "reviewer") {
      const policy = workflow.reviewPolicy ?? ReviewPolicy.HUMAN;
      if (policy === ReviewPolicy.HUMAN) {
        skipped.push({ role, reason: "Review policy: human (heartbeat handles via PR polling)" });
        continue;
      }
      if (policy === ReviewPolicy.SKIP) {
        skipped.push({ role, reason: "Review policy: skip (heartbeat handles via review-skip pass)" });
        continue;
      }
    }

    // Test policy gate: fallback for issues dispatched before test routing labels existed
    if (role === "tester") {
      const policy = workflow.testPolicy ?? TestPolicy.SKIP;
      if (policy === TestPolicy.SKIP) {
        skipped.push({ role, reason: "Test policy: skip (heartbeat handles via test-skip pass)" });
        continue;
      }
    }

    const next = await findNextIssueForRole(provider, role, workflow, instanceName);
    if (!next) continue;

    const { issue, label: currentLabel } = next;
    const holdLabel = getLoopBrakeHoldLabel(workflow);
    const loopBrake = await evaluateLoopBrake(workspaceDir, issue.iid);
    await recordLoopDiagnostic(workspaceDir, "loop_brake_evaluation", {
      project: project.name,
      projectSlug: project.slug,
      issueId: issue.iid,
      role,
      currentLabel,
      holdLabel,
      blocked: loopBrake.blocked,
      threshold: loopBrake.threshold,
      windowMs: loopBrake.windowMs,
      auditScan: loopBrake.auditScan,
      eventCount: loopBrake.events.length,
      events: loopBrake.events,
      reasonHistogram: loopBrake.reasonHistogram,
      sourceHistogram: loopBrake.sourceHistogram,
      issueLabels: issue.labels,
      countedEventSummaries: loopBrake.events.map((event, index) => ({
        index,
        ts: event.ts,
        source: event.source,
        stage: event.stage ?? null,
        event: event.event ?? null,
        from: event.from ?? null,
        to: event.to ?? null,
        reason: event.reason,
        rawReason: event.rawReason ?? null,
        orphanReason: event.orphanReason ?? null,
        countedByRule: event.countedByRule ?? null,
        rawEvent: event.rawEvent ?? null,
        rawStage: event.rawStage ?? null,
        rawResult: event.rawResult ?? null,
        issueFieldUsed: event.issueFieldUsed ?? null,
        rawIssueId: event.rawIssueId ?? null,
        rawIssue: event.rawIssue ?? null,
        rawLabelPair: event.rawLabelPair ?? null,
        matchedBecause: event.matchedBecause ?? null,
        rawLoopBrakeReason: event.rawLoopBrakeReason ?? null,
        rawTransitionReasonCategory: event.rawTransitionReasonCategory ?? null,
        rawRefiningDecisionPath: event.rawRefiningDecisionPath ?? null,
        rawHealthDecisionCategory: event.rawHealthDecisionCategory ?? null,
        rawSourceBranch: event.rawSourceBranch ?? null,
        rawRepoPath: event.rawRepoPath ?? null,
        rawPluginSourceRoot: event.rawPluginSourceRoot ?? null,
        rawBranchResolutionDecision: event.rawBranchResolutionDecision ?? null,
        rawPrValidationDecision: event.rawPrValidationDecision ?? null,
        rawPrValidationLookupOutcome: event.rawPrValidationLookupOutcome ?? null,
        rawRepoSnapshot: event.rawRepoSnapshot ?? null,
        rawPluginSnapshot: event.rawPluginSnapshot ?? null,
        eventShapeSummary: event.eventShapeSummary ?? null,
        compactDecisionSummary: event.compactDecisionSummary ?? null,
        rawHealthDecisionSummary: event.rawHealthDecisionSummary ?? null,
        rawBranchWinnerSummary: event.rawBranchWinnerSummary ?? null,
        rawDuplicateSourceDecision: event.rawDuplicateSourceDecision ?? null,
        rawPreferredBranchSource: event.rawPreferredBranchSource ?? null,
        rawBranchResolutionPreferredEvidence: event.rawBranchResolutionPreferredEvidence ?? null,
        rawPreferredBranchConfidence: event.rawPreferredBranchConfidence ?? null,
        rawLaneMismatchSummary: event.rawLaneMismatchSummary ?? null,
        rawLaneMismatchCategory: event.rawLaneMismatchCategory ?? null,
        rawDuplicateSourceRisk: event.rawDuplicateSourceRisk ?? null,
        rawCanRequeueIssue: event.rawCanRequeueIssue ?? null,
        rawAuditExcerpt: event.rawAuditExcerpt ?? null,
        decisionPath: event.decisionPath ?? null,
      })),
      countedBecause: loopBrake.events.length > 0
        ? `counted ${loopBrake.events.length} events inside the retry window because they matched loop-brake rules for health_requeue, work_finish -> Refining, or review_transition non-progress reasons`
        : `no prior loop events matched inside the retry window; ${loopBrake.auditScan.matchOutcomeSummary}`,
      auditScanDecisionSummary: `${loopBrake.auditScan.matchOutcomeCategory}: ${loopBrake.auditScan.matchOutcomeSummary}`,
      mostRecentMatchedLoopEvent: loopBrake.auditScan.newestMatchedEventTs
        ? {
            ts: loopBrake.auditScan.newestMatchedEventTs,
            reason: loopBrake.auditScan.newestMatchedEventReason,
            insideRetryWindow: loopBrake.auditScan.newestMatchedEventInsideWindowTs === loopBrake.auditScan.newestMatchedEventTs,
          }
        : null,
      decisionPath: holdLabel
        ? loopBrake.blocked
          ? `loop brake will move ${currentLabel} -> ${holdLabel} because ${loopBrake.events.length} recent non-progress loop events met threshold ${loopBrake.threshold}`
          : `loop brake allowed dispatch because ${loopBrake.events.length} recent non-progress loop events is below threshold ${loopBrake.threshold}`
        : "loop brake skipped because no hold label could be resolved from workflow",
    }).catch(() => {});
    if (holdLabel && loopBrake.blocked) {
      const reason = `retry ceiling reached after ${loopBrake.events.length} recent non-progress loop events`;
      await provider.transitionLabel(issue.iid, currentLabel, holdLabel);
      await provider.addComment(
        issue.iid,
        [
          "## Loop brake triggered",
          "",
          `Automatic redispatch has been halted for this issue after ${loopBrake.events.length} recent non-progress loop events within the retry window.`,
          "",
          `- from queue: \`${currentLabel}\``,
          `- moved to hold: \`${holdLabel}\``,
          `- threshold: ${loopBrake.threshold}`,
          `- recent reasons: ${loopBrake.events.map((event) => event.reason).join(", ")}`,
          "",
          "Operator action is required to re-queue this issue.",
        ].join("\n"),
      );
      await recordLoopDiagnostic(workspaceDir, "loop_brake_halt", {
        project: project.name,
        projectSlug: project.slug,
        issueId: issue.iid,
        role,
        from: currentLabel,
        to: holdLabel,
        threshold: loopBrake.threshold,
        windowMs: loopBrake.windowMs,
        auditScan: loopBrake.auditScan,
        events: loopBrake.events,
        reasonHistogram: loopBrake.reasonHistogram,
        sourceHistogram: loopBrake.sourceHistogram,
        countedEventSummaries: loopBrake.events.map((event, index) => ({
          index,
          ts: event.ts,
          source: event.source,
          stage: event.stage ?? null,
          event: event.event ?? null,
          from: event.from ?? null,
          to: event.to ?? null,
          reason: event.reason,
          rawReason: event.rawReason ?? null,
          orphanReason: event.orphanReason ?? null,
          countedByRule: event.countedByRule ?? null,
          rawEvent: event.rawEvent ?? null,
          rawStage: event.rawStage ?? null,
          rawResult: event.rawResult ?? null,
          issueFieldUsed: event.issueFieldUsed ?? null,
          rawIssueId: event.rawIssueId ?? null,
          rawIssue: event.rawIssue ?? null,
          rawLabelPair: event.rawLabelPair ?? null,
          matchedBecause: event.matchedBecause ?? null,
          rawLoopBrakeReason: event.rawLoopBrakeReason ?? null,
          rawTransitionReasonCategory: event.rawTransitionReasonCategory ?? null,
          rawRefiningDecisionPath: event.rawRefiningDecisionPath ?? null,
          rawHealthDecisionCategory: event.rawHealthDecisionCategory ?? null,
          rawSourceBranch: event.rawSourceBranch ?? null,
          rawRepoPath: event.rawRepoPath ?? null,
          rawPluginSourceRoot: event.rawPluginSourceRoot ?? null,
          rawBranchResolutionDecision: event.rawBranchResolutionDecision ?? null,
          rawPrValidationDecision: event.rawPrValidationDecision ?? null,
          rawPrValidationLookupOutcome: event.rawPrValidationLookupOutcome ?? null,
          rawRepoSnapshot: event.rawRepoSnapshot ?? null,
          rawPluginSnapshot: event.rawPluginSnapshot ?? null,
          eventShapeSummary: event.eventShapeSummary ?? null,
          compactDecisionSummary: event.compactDecisionSummary ?? null,
          rawHealthDecisionSummary: event.rawHealthDecisionSummary ?? null,
          rawBranchWinnerSummary: event.rawBranchWinnerSummary ?? null,
          rawDuplicateSourceDecision: event.rawDuplicateSourceDecision ?? null,
          rawPreferredBranchSource: event.rawPreferredBranchSource ?? null,
          rawBranchResolutionPreferredEvidence: event.rawBranchResolutionPreferredEvidence ?? null,
          rawPreferredBranchConfidence: event.rawPreferredBranchConfidence ?? null,
          rawLaneMismatchSummary: event.rawLaneMismatchSummary ?? null,
          rawLaneMismatchCategory: event.rawLaneMismatchCategory ?? null,
          rawDuplicateSourceRisk: event.rawDuplicateSourceRisk ?? null,
          rawCanRequeueIssue: event.rawCanRequeueIssue ?? null,
          rawAuditExcerpt: event.rawAuditExcerpt ?? null,
          decisionPath: event.decisionPath ?? null,
        })),
        countedBecause: `loop brake threshold ${loopBrake.threshold} was met by ${loopBrake.events.length} events that matched non-progress counting rules inside the retry window`,
        auditScanDecisionSummary: `${loopBrake.auditScan.matchOutcomeCategory}: ${loopBrake.auditScan.matchOutcomeSummary}`,
        mostRecentMatchedLoopEvent: loopBrake.auditScan.newestMatchedEventTs
          ? {
              ts: loopBrake.auditScan.newestMatchedEventTs,
              reason: loopBrake.auditScan.newestMatchedEventReason,
              insideRetryWindow: loopBrake.auditScan.newestMatchedEventInsideWindowTs === loopBrake.auditScan.newestMatchedEventTs,
            }
          : null,
        haltClassification: "issue was moved to the hold label because redispatch would likely repeat without new information",
        issueLabels: issue.labels,
        loopBrakeReason: "retry_ceiling_reached",
        decisionPath: `loop brake moved ${currentLabel} -> ${holdLabel} after ${loopBrake.events.length} recent non-progress loop events`,
      }).catch(() => {});
      await recordLoopBrakeHalt({
        workspaceDir,
        project: project.name,
        issueId: issue.iid,
        issueTitle: issue.title,
        from: currentLabel,
        to: holdLabel,
        reason,
        threshold: loopBrake.threshold,
        events: loopBrake.events,
      });
      skipped.push({ role, reason: `Loop brake: #${issue.iid} moved to ${holdLabel}` });
      continue;
    }

    const targetLabel = getActiveLabel(workflow, role);

    // Step routing: check for review:human / review:skip / test:skip labels
    if (role === "reviewer") {
      const routing = detectStepRouting(issue.labels, "review");
      if (routing === "human" || routing === "skip") {
        skipped.push({ role, reason: `review:${routing} label` });
        continue;
      }
    }
    if (role === "tester") {
      const routing = detectStepRouting(issue.labels, "test");
      if (routing === "skip") {
        skipped.push({ role, reason: "test:skip label" });
        continue;
      }
    }

    // Level selection: label → heuristic (must happen before free slot check)
    const selectedLevel = resolveLevelForIssue(issue, role);

    // Check per-level slot availability
    const freeSlot = findFreeSlot(roleWorker, selectedLevel);
    if (freeSlot === null) {
      skipped.push({ role, reason: `${selectedLevel} slots full` });
      continue;
    }

    if (dryRun) {
      const existingSession = roleWorker.levels[selectedLevel]?.[freeSlot]?.sessionKey;
      pickups.push({
        project: project.name, projectSlug, issueId: issue.iid, issueTitle: issue.title, issueUrl: issue.web_url,
        role, level: selectedLevel,
        sessionAction: existingSession ? "send" : "spawn",
        announcement: `[DRY RUN] Would pick up #${issue.iid}`,
      });
    } else {
      try {
        const dr = await dispatchTask({
          workspaceDir, agentId, project: fresh, issueId: issue.iid,
          issueTitle: issue.title, issueDescription: issue.description ?? "", issueUrl: issue.web_url,
          role, level: selectedLevel, fromLabel: currentLabel, toLabel: targetLabel,
          provider,
          pluginConfig,
          sessionKey,
          runtime,
          slotIndex: freeSlot,
          instanceName,
          runCommand: runCommand!,
        });
        pickups.push({
          project: project.name, projectSlug, issueId: issue.iid, issueTitle: issue.title, issueUrl: issue.web_url,
          role, level: dr.level, sessionAction: dr.sessionAction, announcement: dr.announcement,
        });
      } catch (err) {
        skipped.push({ role, reason: `Dispatch failed: ${(err as Error).message}` });
        continue;
      }
    }
    pickupCount++;
  }

  return { pickups, skipped };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Determine the level for an issue based on labels and heuristic fallback.
 *
 * Priority:
 * 1. This role's own label (e.g. tester:medior from a previous dispatch)
 * 2. Inherit from another role's label (e.g. developer:medior → tester uses medior)
 * 3. Heuristic fallback (first dispatch, no labels yet)
 */
function resolveLevelForIssue(issue: Issue, role: Role): string {
  const roleLevel = detectRoleLevelFromLabels(issue.labels);

  // Own role label
  if (roleLevel?.role === role) return roleLevel.level;

  // Inherit from another role's label if level is valid for this role
  if (roleLevel) {
    const levels = getLevelsForRole(role);
    if (levels.includes(roleLevel.level)) return roleLevel.level;
  }

  // Heuristic fallback
  return selectLevel(issue.title, issue.description ?? "", role).level;
}
