/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { StateLabel, IssueProvider } from "../providers/provider.js";
import { deactivateWorker, loadProjectBySlug, getRoleWorker } from "../projects/index.js";
import type { RunCommand } from "../context.js";
import { notify, getNotificationConfig } from "../dispatch/notify.js";
import { log as auditLog } from "../audit.js";
import { recordAndApplyInterventionEvent } from "../orchestrator-intervention/engine.js";
import { loadConfig } from "../config/index.js";
import { detectStepRouting } from "./queue-scan.js";
import { recordLoopDiagnostic } from "./loop-diagnostics.js";
import {
  DEFAULT_WORKFLOW,
  Action,
  getCompletionRule,
  getNextStateDescription,
  getCompletionEmoji,
  getCurrentStateLabel,
  resolveNotifyChannel,
  findStateKeyByLabel,
  getDeliveryPhaseForLabel,
  recordPromotedCandidate,
  markCandidateStatus,
  type CompletionRule,
  type WorkflowConfig,
} from "../workflow/index.js";
import type { Channel } from "../projects/index.js";

export type { CompletionRule };

export type CompletionOutput = {
  labelTransition: string;
  announcement: string;
  nextState: string;
  prUrl?: string;
  issueUrl?: string;
  issueClosed?: boolean;
  issueReopened?: boolean;
};

function getRefiningCommentPrefix(role: string): string {
  switch (role) {
    case "developer":
      return "🔧 **DEVELOPER**";
    case "tester":
      return "🧪 **TESTER**";
    case "reviewer":
      return "👁️ **REVIEWER**";
    case "architect":
      return "🏗️ **ARCHITECT**";
    default:
      return "🎛️ **ORCHESTRATOR**";
  }
}

export function buildRefiningHoldComment(opts: {
  role: string;
  result: string;
  from: string;
  to: string;
  summary?: string;
  source?: "worker" | "system";
}): string {
  const {
    role,
    result,
    from,
    to,
    summary,
    source = "worker",
  } = opts;

  const lines = [
    `${getRefiningCommentPrefix(role)}: Refining hold reason`,
    "",
    `DevClaw is moving this issue from \`${from}\` to \`${to}\` because work cannot continue yet.`,
    "",
    "### Why this is on hold",
    "",
    `- ${summary?.trim() || "Work stopped without a summary, and operator follow-up is required before this issue can continue."}`,
    "",
    "### Transition details",
    "",
    `- from: \`${from}\``,
    `- to: \`${to}\``,
    `- category: \`work_finish_${result}\``,
    `- source: \`${source}\``,
    "",
    "### Context",
    "",
    `- role: \`${role}\``,
    `- result: \`${result}\``,
    "",
    "Please review this hold reason and update the issue before re-queueing it.",
  ];

  return lines.join("\n");
}

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 */
export function getRule(
  role: string,
  result: string,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
  currentLabel?: string | null,
): CompletionRule | undefined {
  return getCompletionRule(workflow, role, result, currentLabel) ?? undefined;
}

/**
 * Execute the completion side-effects for a role:result pair.
 */
export async function executeCompletion(opts: {
  workspaceDir: string;
  projectSlug: string;
  role: string;
  result: string;
  issueId: number;
  summary?: string;
  prUrl?: string;
  provider: IssueProvider;
  repoPath: string;
  projectName: string;
  channels: Channel[];
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
  /** Agent id used for orchestrator wake delivery */
  agentId?: string;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Tasks created during this work session (e.g. architect implementation tasks) */
  createdTasks?: Array<{ id: number; title: string; url: string }>;
  /** Level of the completing worker */
  level?: string;
  /** Slot index within the level's array */
  slotIndex?: number;
  runCommand: RunCommand;
}): Promise<CompletionOutput> {
  const rc = opts.runCommand;
  const {
    workspaceDir, projectSlug, role, result, issueId, summary, provider,
    repoPath, projectName, channels, pluginConfig, runtime,
    workflow = DEFAULT_WORKFLOW,
    createdTasks,
  } = opts;

  const key = `${role}:${result}`;
  const issue = await provider.getIssue(issueId);
  const currentLabel = getCurrentStateLabel(issue.labels, workflow);
  const rule = getCompletionRule(workflow, role, result, currentLabel);
  if (!rule) throw new Error(`No completion rule for ${key}`);

  const { timeouts } = await loadConfig(workspaceDir, projectName);
  let prUrl = opts.prUrl;
  let mergedPr = false;
  let prTitle: string | undefined;
  let sourceBranch: string | undefined;

  // Execute pre-notification actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.GIT_PULL:
        try { await rc(["git", "pull"], { timeoutMs: timeouts.gitPullMs, cwd: repoPath }); } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "gitPull", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        }
        break;
      case Action.DETECT_PR:
        if (!prUrl) { try {
          // Try open PR first (developer just finished — MR is still open), fall back to merged
          const prStatus = await provider.getPrStatus(issueId);
          prUrl = prStatus.url ?? await provider.getMergedMRUrl(issueId) ?? undefined;
          prTitle = prStatus.title;
          sourceBranch = prStatus.sourceBranch;
        } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "detectPr", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        } }
        break;
      case Action.MERGE_PR:
        try {
          // Grab PR metadata before merging (the MR is still open at this point)
          if (!prTitle) {
            try {
              const prStatus = await provider.getPrStatus(issueId);
              prUrl = prUrl ?? prStatus.url ?? undefined;
              prTitle = prStatus.title;
              sourceBranch = prStatus.sourceBranch;
            } catch { /* best-effort */ }
          }
          await provider.mergePr(issueId);
          mergedPr = true;
        } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "mergePr", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        }
        break;
    }
  }

  const notifyTarget = resolveNotifyChannel(issue.labels, channels);

  // Get next state description from workflow
  const nextState = getNextStateDescription(workflow, role, result, currentLabel);

  // Retrieve worker name from project state (best-effort)
  let workerName: string | undefined;
  try {
    const project = await loadProjectBySlug(workspaceDir, projectSlug);
    if (project && opts.level !== undefined && opts.slotIndex !== undefined) {
      const roleWorker = getRoleWorker(project, role);
      const slot = roleWorker.levels[opts.level]?.[opts.slotIndex];
      workerName = slot?.name;
    }
  } catch {
    // Best-effort — don't fail notification if name retrieval fails
  }

  // Send notification early (before deactivation and label transition which can fail)
  const notifyConfig = getNotificationConfig(pluginConfig);
  try {
    await notify(
      {
        type: "workerComplete",
        project: projectName,
        issueId,
        issueUrl: issue.web_url,
        role,
        level: opts.level,
        name: workerName,
        result: result as "done" | "pass" | "fail" | "refine" | "blocked",
        summary,
        nextState,
        prUrl,
        createdTasks,
      },
      {
        workspaceDir,
        config: notifyConfig,
        channelId: notifyTarget?.channelId,
        channel: notifyTarget?.channel ?? "telegram",
        runtime,
        accountId: notifyTarget?.accountId,
        runCommand: rc,
        messageThreadId: notifyTarget?.messageThreadId,
      },
    );
  } catch (err) {
    auditLog(workspaceDir, "pipeline_warning", { step: "notify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
  }

  // Send merge notification when PR was merged during this completion
  if (mergedPr) {
    try {
      await notify(
        {
          type: "prMerged",
          project: projectName,
          issueId,
          issueUrl: issue.web_url,
          issueTitle: issue.title,
          prUrl,
          prTitle,
          sourceBranch,
          mergedBy: "pipeline",
        },
        { workspaceDir, config: notifyConfig, channelId: notifyTarget?.channelId, channel: notifyTarget?.channel ?? "telegram", runtime, accountId: notifyTarget?.accountId, runCommand: rc, messageThreadId: notifyTarget?.messageThreadId },
      );
    } catch (err) {
      auditLog(workspaceDir, "pipeline_warning", { step: "mergeNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
    }
  }

  // Transition label first (critical — if this fails, issue still has correct state)
  // Then execute post-transition actions (close/reopen)
  // Finally deactivate worker (last — ensures label is set even if deactivation fails)
  const transitionedTo = rule.to as StateLabel;
  const toStateKey = findStateKeyByLabel(workflow, transitionedTo);
  const toPhase = getDeliveryPhaseForLabel(workflow, transitionedTo);
  const fromPhase = getDeliveryPhaseForLabel(workflow, rule.from);
  if (transitionedTo === "Refining") {
    await provider.addComment(issueId, buildRefiningHoldComment({
      role,
      result,
      from: rule.from,
      to: transitionedTo,
      summary,
      source: "worker",
    }));
  }
  await provider.transitionLabel(issueId, rule.from as StateLabel, transitionedTo);

  if (fromPhase === "promotion" && result === "done") {
    await recordPromotedCandidate({
      provider,
      issueId,
      repoPath,
      runCommand: rc,
      prUrl,
      targetHint: transitionedTo,
    }).catch(() => {});
  }

  if (toStateKey === "done" && fromPhase === "acceptance") {
    await markCandidateStatus({ provider, issueId, status: "accepted", reason: summary }).catch(() => {});
  }

  if ((toStateKey === "toImprove" || toStateKey === "refining") && (fromPhase === "promotion" || fromPhase === "acceptance")) {
    await markCandidateStatus({ provider, issueId, status: "invalidated", reason: summary }).catch(() => {});
  }

  await recordLoopDiagnostic(workspaceDir, "work_finish_transition", {
    project: projectName,
    issueId,
    role,
    result,
    from: rule.from,
    to: transitionedTo,
    summary: summary ?? null,
    prUrl: prUrl ?? null,
  }).catch(() => {});

  // Execute post-transition actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.CLOSE_ISSUE:
        await provider.closeIssue(issueId);
        // Notify that the issue has been fully completed and closed
        try {
          await notify(
            {
              type: "issueComplete",
              project: projectName,
              issueId,
              issueUrl: issue.web_url,
              issueTitle: issue.title,
              prUrl,
            },
            {
              workspaceDir,
              config: notifyConfig,
              channelId: notifyTarget?.channelId,
              channel: notifyTarget?.channel ?? "telegram",
              runtime,
              accountId: notifyTarget?.accountId,
              runCommand: rc,
              messageThreadId: notifyTarget?.messageThreadId,
            },
          );
        } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "issueCompleteNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        }
        break;
      case Action.REOPEN_ISSUE:
        await provider.reopenIssue(issueId);
        break;
    }
  }

  // Deactivate worker last (non-critical — session cleanup)
  await deactivateWorker(workspaceDir, projectSlug, role, { level: opts.level, slotIndex: opts.slotIndex, issueId: String(issueId) });

  // Send review routing notification when developer completes
  if (role === "developer" && result === "done") {
    // Re-fetch issue to get labels after transition
    const updated = await provider.getIssue(issueId);
    const routing = detectStepRouting(updated.labels, "review") as "human" | "agent" | null;
    if (routing === "human" || routing === "agent") {
      try {
        await notify(
          {
            type: "reviewNeeded",
            project: projectName,
            issueId,
            issueUrl: updated.web_url,
            issueTitle: updated.title,
            routing,
            prUrl,
          },
          {
            workspaceDir,
            config: notifyConfig,
            channelId: notifyTarget?.channelId,
            channel: notifyTarget?.channel ?? "telegram",
            runtime,
            accountId: notifyTarget?.accountId,
            runCommand: rc,
            messageThreadId: notifyTarget?.messageThreadId,
          },
        );
      } catch (err) {
        auditLog(workspaceDir, "pipeline_warning", { step: "reviewNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
      }
    }
  }

  const interventionProject = await loadProjectBySlug(workspaceDir, projectSlug);
  if (interventionProject) {
    const updatedIssue = await provider.getIssue(issueId);
    const eventType = transitionedTo === "Refining"
      ? "workflow.hold"
      : "worker.completed";
    await recordAndApplyInterventionEvent({
      workspaceDir,
      channelId: notifyTarget?.channelId ?? interventionProject.channels[0]?.channelId ?? projectSlug,
      messageThreadId: notifyTarget?.messageThreadId,
      agentId: opts.agentId,
      project: interventionProject,
      workflow,
      provider,
      issue: updatedIssue,
      runCommand: rc,
    }, {
      eventType,
      issueId,
      role,
      level: opts.level,
      result,
      reason: transitionedTo === "Refining" ? result : undefined,
      fromState: rule.from,
      toState: transitionedTo,
      prUrl: prUrl ?? null,
      source: "worker",
      data: { summary: summary ?? null, createdTasks: createdTasks ?? null },
    }).catch(() => {});

    if (mergedPr) {
      await recordAndApplyInterventionEvent({
        workspaceDir,
        channelId: notifyTarget?.channelId ?? interventionProject.channels[0]?.channelId ?? projectSlug,
        messageThreadId: notifyTarget?.messageThreadId,
        agentId: opts.agentId,
        project: interventionProject,
        workflow,
        provider,
        issue: updatedIssue,
        runCommand: rc,
      }, {
        eventType: "pr.merged",
        issueId,
        role,
        level: opts.level,
        prUrl: prUrl ?? null,
        source: "worker",
        data: { mergedBy: "pipeline" },
      }).catch(() => {});
    }
  }

  // Build announcement using workflow-derived emoji
  const emoji = getCompletionEmoji(role, result);
  const label = key.replace(":", " ").toUpperCase();
  let announcement = `${emoji} ${label} #${issueId}`;
  if (summary) announcement += ` — ${summary}`;
  announcement += `\n📋 [Issue #${issueId}](${issue.web_url})`;
  if (prUrl) announcement += `\n🔗 [PR](${prUrl})`;
  if (createdTasks && createdTasks.length > 0) {
    announcement += `\n📌 Created tasks:`;
    for (const t of createdTasks) {
      announcement += `\n  - [#${t.id}: ${t.title}](${t.url})`;
    }
  }
  announcement += `\n${nextState}.`;

  return {
    labelTransition: `${rule.from} → ${rule.to}`,
    announcement,
    nextState,
    prUrl,
    issueUrl: issue.web_url,
    issueClosed: rule.actions.includes(Action.CLOSE_ISSUE),
    issueReopened: rule.actions.includes(Action.REOPEN_ISSUE),
  };
}
