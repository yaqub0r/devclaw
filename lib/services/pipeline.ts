/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StateLabel, IssueProvider } from "../providers/provider.js";
import { deactivateWorker, loadProjectBySlug, getRoleWorker } from "../projects/index.js";
import type { RunCommand } from "../context.js";
import { notify, getNotificationConfig } from "../dispatch/notify.js";
import { log as auditLog } from "../audit.js";
import { loadConfig } from "../config/index.js";
import { detectStepRouting } from "./queue-scan.js";
import { recordLoopDiagnostic } from "./loop-diagnostics.js";
import {
  DEFAULT_WORKFLOW,
  Action,
  getCompletionRule,
  getNextStateDescription,
  getCompletionEmoji,
  resolveNotifyChannel,
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

function getPluginSourceRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

async function getGitSnapshot(repoPath: string, runCommand: RunCommand): Promise<Record<string, unknown>> {
  const commands: Array<[string, string[]]> = [
    ["branch", ["git", "branch", "--show-current"]],
    ["head", ["git", "rev-parse", "HEAD"]],
    ["headBranches", ["git", "branch", "--format=%(refname:short)", "--points-at", "HEAD"]],
    ["symbolicHead", ["git", "symbolic-ref", "--short", "HEAD"]],
    ["gitDir", ["git", "rev-parse", "--absolute-git-dir"]],
    ["gitCommonDir", ["git", "rev-parse", "--git-common-dir"]],
    ["workTree", ["git", "rev-parse", "--show-toplevel"]],
    ["originHead", ["git", "rev-parse", "--abbrev-ref", "origin/HEAD"]],
    ["statusShort", ["git", "status", "--short"]],
    ["worktreeList", ["git", "worktree", "list", "--porcelain"]],
  ];

  let realRepoPath: string | null = null;
  try {
    realRepoPath = await realpath(repoPath);
  } catch {
    realRepoPath = null;
  }

  const snapshot: Record<string, unknown> = {
    repoPath,
    realRepoPath,
    cwd: repoPath,
    processCwd: process.cwd(),
  };
  for (const [key, argv] of commands) {
    try {
      const result = await runCommand(argv, { timeoutMs: 5_000, cwd: repoPath });
      snapshot[key] = result.stdout.trim() || null;
    } catch (err) {
      snapshot[`${key}Error`] = (err as Error).message ?? String(err);
    }
  }
  return snapshot;
}

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 */
export function getRule(
  role: string,
  result: string,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): CompletionRule | undefined {
  return getCompletionRule(workflow, role, result) ?? undefined;
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
  const rule = getCompletionRule(workflow, role, result);
  if (!rule) throw new Error(`No completion rule for ${key}`);

  const { timeouts } = await loadConfig(workspaceDir, projectName);
  let prUrl = opts.prUrl;
  let mergedPr = false;
  let prTitle: string | undefined;
  let sourceBranch: string | undefined;
  const pluginSourceRoot = getPluginSourceRoot();
  const [repoSnapshot, pluginSnapshot] = await Promise.all([
    getGitSnapshot(repoPath, rc),
    getGitSnapshot(pluginSourceRoot, rc),
  ]);
  const branchDecisionContext = {
    repoBranch: typeof repoSnapshot.branch === "string" ? repoSnapshot.branch : null,
    repoWorkTree: typeof repoSnapshot.workTree === "string" ? repoSnapshot.workTree : null,
    repoRealPath: typeof repoSnapshot.realRepoPath === "string" ? repoSnapshot.realRepoPath : null,
    repoHeadBranches: typeof repoSnapshot.headBranches === "string" ? repoSnapshot.headBranches.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    pluginBranch: typeof pluginSnapshot.branch === "string" ? pluginSnapshot.branch : null,
    pluginWorkTree: typeof pluginSnapshot.workTree === "string" ? pluginSnapshot.workTree : null,
    pluginRealPath: typeof pluginSnapshot.realRepoPath === "string" ? pluginSnapshot.realRepoPath : null,
    pluginHeadBranches: typeof pluginSnapshot.headBranches === "string" ? pluginSnapshot.headBranches.split("\n").map((s) => s.trim()).filter(Boolean) : [],
  };

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
          const mergedFallbackUrl = prStatus.url ? null : await provider.getMergedMRUrl(issueId);
          prUrl = prStatus.url ?? mergedFallbackUrl ?? undefined;
          prTitle = prStatus.title;
          sourceBranch = prStatus.sourceBranch;
          await recordLoopDiagnostic(workspaceDir, "pipeline_detect_pr", {
            project: projectName,
            issueId,
            role,
            result,
            detectedPrUrl: prStatus.url ?? null,
            mergedFallbackUrl,
            finalPrUrl: prUrl ?? null,
            prDetectionSource: prStatus.url ? "open_pr_status" : mergedFallbackUrl ? "merged_pr_fallback" : "no_pr_found",
            prTitle: prTitle ?? null,
            sourceBranch: sourceBranch ?? null,
            mergeable: prStatus.mergeable ?? null,
            prState: prStatus.state,
            repoPath,
            repoSnapshot,
            pluginSourceRoot,
            pluginSnapshot,
            branchDecisionContext: {
              ...branchDecisionContext,
              sourceBranch: sourceBranch ?? null,
              repoBranchMatchesSourceBranch: branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch,
              pluginBranchMatchesSourceBranch: branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch,
            },
            branchDecisionNotes: [
              branchDecisionContext.repoWorkTree === branchDecisionContext.pluginWorkTree ? "repoPath and plugin source report the same worktree" : "repoPath and plugin source report different worktrees",
              branchDecisionContext.repoBranch === branchDecisionContext.pluginBranch ? "repoPath and plugin source report the same current branch" : "repoPath and plugin source report different current branches",
              sourceBranch && branchDecisionContext.repoHeadBranches.includes(sourceBranch) ? "repo HEAD points at detected source branch" : "repo HEAD does not point at detected source branch",
              sourceBranch && branchDecisionContext.pluginHeadBranches.includes(sourceBranch) ? "plugin HEAD points at detected source branch" : "plugin HEAD does not point at detected source branch",
            ],
            decisionPath: prStatus.url
              ? "provider returned PR status directly during DETECT_PR action"
              : mergedFallbackUrl
                ? "provider returned no open PR URL, then pipeline found a merged PR fallback"
                : "provider returned no open PR URL and merged PR fallback also found nothing",
          }).catch(() => {});
        } catch (err) {
          await recordLoopDiagnostic(workspaceDir, "pipeline_detect_pr_error", {
            project: projectName,
            issueId,
            role,
            result,
            repoPath,
            repoSnapshot,
            pluginSourceRoot,
            pluginSnapshot,
            error: (err as Error).message ?? String(err),
          }).catch(() => {});
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

  // Get issue early (for URL in notification + channel routing)
  const issue = await provider.getIssue(issueId);
  const notifyTarget = resolveNotifyChannel(issue.labels, channels);

  // Get next state description from workflow
  const nextState = getNextStateDescription(workflow, role, result);

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
  notify(
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
    },
  ).catch((err) => {
    auditLog(workspaceDir, "pipeline_warning", { step: "notify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
  });

  // Send merge notification when PR was merged during this completion
  if (mergedPr) {
    notify(
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
      { workspaceDir, config: notifyConfig, channelId: notifyTarget?.channelId, channel: notifyTarget?.channel ?? "telegram", runtime, accountId: notifyTarget?.accountId },
    ).catch((err) => {
      auditLog(workspaceDir, "pipeline_warning", { step: "mergeNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
    });
  }

  // Transition label first (critical — if this fails, issue still has correct state)
  // Then execute post-transition actions (close/reopen)
  // Finally deactivate worker (last — ensures label is set even if deactivation fails)
  const transitionedTo = rule.to as StateLabel;

  await recordLoopDiagnostic(workspaceDir, "work_finish_transition_planned", {
    project: projectName,
    issueId,
    role,
    result,
    from: rule.from,
    to: transitionedTo,
    summary: summary ?? null,
    prUrl: prUrl ?? null,
    sourceBranch: sourceBranch ?? null,
    repoPath,
    repoSnapshot,
    pluginSourceRoot,
    pluginSnapshot,
    actions: rule.actions,
    loopBrakeReason: transitionedTo === "Refining" ? `work_finish_${result}` : null,
    refiningTransition: transitionedTo === "Refining",
    branchDecisionContext: {
      ...branchDecisionContext,
      sourceBranch: sourceBranch ?? null,
      repoBranchMatchesSourceBranch: branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch,
      pluginBranchMatchesSourceBranch: branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch,
    },
    decisionPath: `completion rule ${key} selected workflow transition ${rule.from} -> ${transitionedTo}`,
  }).catch(() => {});

  await provider.transitionLabel(issueId, rule.from as StateLabel, transitionedTo);

  await recordLoopDiagnostic(workspaceDir, "work_finish_transition", {
    project: projectName,
    issueId,
    role,
    result,
    from: rule.from,
    to: transitionedTo,
    summary: summary ?? null,
    prUrl: prUrl ?? null,
    sourceBranch: sourceBranch ?? null,
    repoPath,
    repoSnapshot,
    pluginSourceRoot,
    pluginSnapshot,
    actions: rule.actions,
    loopBrakeReason: transitionedTo === "Refining" ? `work_finish_${result}` : null,
    refiningTransition: transitionedTo === "Refining",
    branchDecisionContext: {
      ...branchDecisionContext,
      sourceBranch: sourceBranch ?? null,
      repoBranchMatchesSourceBranch: branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch,
      pluginBranchMatchesSourceBranch: branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch,
    },
    decisionPath: `completion rule ${key} completed workflow transition ${rule.from} -> ${transitionedTo}`,
  }).catch(() => {});

  // Execute post-transition actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.CLOSE_ISSUE:
        await provider.closeIssue(issueId);
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
      notify(
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
        },
      ).catch((err) => {
        auditLog(workspaceDir, "pipeline_warning", { step: "reviewNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
      });
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
