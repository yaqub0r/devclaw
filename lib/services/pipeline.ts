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

async function tryRealpath(pathValue: unknown): Promise<string | null> {
  if (typeof pathValue !== "string" || !pathValue.trim()) return null;
  try {
    return await realpath(pathValue);
  } catch {
    return null;
  }
}

function summarizePluginSourceConfig(opts: {
  installSourceRealPath: string | null;
  installPathRealPath: string | null;
  pluginLoadPathRealPaths: Array<string | null>;
  pluginRealPath: string | null;
}): Record<string, unknown> {
  const distinctRealPaths = Array.from(new Set(
    [opts.installSourceRealPath, opts.installPathRealPath, ...opts.pluginLoadPathRealPaths, opts.pluginRealPath]
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ));
  const conflictingRealPaths = opts.installSourceRealPath === null
    ? distinctRealPaths
    : distinctRealPaths.filter((realPath) => realPath !== opts.installSourceRealPath);

  const pluginLoadPathsDistinctFromInstallSource = opts.pluginLoadPathRealPaths
    .filter((realPath): realPath is string => typeof realPath === "string" && realPath.length > 0)
    .filter((realPath) => realPath !== opts.installSourceRealPath);
  const duplicateSourceRisk =
    opts.installSourceRealPath !== null
    && opts.pluginLoadPathRealPaths.some((realPath) => realPath !== null && realPath !== opts.installSourceRealPath);

  return {
    distinctDevclawRealPaths: distinctRealPaths,
    distinctDevclawRealPathCount: distinctRealPaths.length,
    conflictingDevclawRealPaths: conflictingRealPaths,
    installSourceMatchesInstalledPath: opts.installSourceRealPath !== null && opts.installSourceRealPath === opts.installPathRealPath,
    installSourceMatchesLivePlugin: opts.installSourceRealPath !== null && opts.installSourceRealPath === opts.pluginRealPath,
    installedPathMatchesLivePlugin: opts.installPathRealPath !== null && opts.installPathRealPath === opts.pluginRealPath,
    pluginLoadPathsContainLivePlugin: opts.pluginRealPath !== null && opts.pluginLoadPathRealPaths.includes(opts.pluginRealPath),
    pluginLoadPathsContainInstallSource: opts.installSourceRealPath !== null && opts.pluginLoadPathRealPaths.includes(opts.installSourceRealPath),
    pluginLoadPathsDistinctFromInstallSource,
    expectedLiveRealPath: opts.installSourceRealPath,
    installedExtensionRealPath: opts.installPathRealPath,
    observedLivePluginRealPath: opts.pluginRealPath,
    likelyWinningLiveRealPath: opts.pluginRealPath ?? opts.installPathRealPath ?? opts.installSourceRealPath,
    duplicateSourceRisk,
    duplicateSourceReasons: [
      duplicateSourceRisk ? `plugins.load.paths contains competing DevClaw realpaths outside install source: ${JSON.stringify(pluginLoadPathsDistinctFromInstallSource)}` : null,
      opts.installSourceRealPath !== null && opts.installPathRealPath !== null && opts.installSourceRealPath !== opts.installPathRealPath
        ? `installed extension realpath ${opts.installPathRealPath} differs from install source ${opts.installSourceRealPath}`
        : null,
      opts.installSourceRealPath !== null && opts.pluginRealPath !== null && opts.installSourceRealPath !== opts.pluginRealPath
        ? `observed live plugin realpath ${opts.pluginRealPath} differs from install source ${opts.installSourceRealPath}`
        : null,
    ].filter((value): value is string => Boolean(value)),
  };
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
    ["ghRepoView", ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]],
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
  /** PR validation summary captured by work_finish before transition logic */
  prValidationSummary?: {
    lookupOutcome: string;
    prUrl: string | null;
    prState: string | null;
    prSourceBranch: string | null;
    prMergeable: boolean | null;
    prLookupProbeDecision?: string | null;
    prLookupProbeSummary?: Record<string, unknown> | null;
    isConflictCycle: boolean | null;
    branchResolution: Record<string, unknown>;
    branchResolutionDecision: string;
    branchResolutionPreferredSource: string | null;
    preferredBranchSource: string | null;
    preferredBranchConfidence: string | null;
    branchResolutionPreferredEvidence: string | null;
    branchWinnerDecisionSummary: string | null;
    branchSelectionWinnerSummary: string | null;
    branchWinnerComparedToLaneSummary: string | null;
    branchSourceCandidateDecisionTable: Array<Record<string, unknown>> | null;
    branchSourceCandidatesInPriorityOrder: Array<Record<string, unknown>> | null;
    branchMismatchSummary: string[] | null;
    laneMismatchCategory: string | null;
  } | null;
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
    prValidationSummary = null,
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
  const openclawConfigPluginLoadPaths =
    Array.isArray((pluginConfig as { load?: { paths?: unknown[] } } | undefined)?.load?.paths)
      ? ((pluginConfig as { load?: { paths?: unknown[] } }).load?.paths ?? [])
      : null;
  const openclawConfigInstallSourcePath =
    typeof (pluginConfig as { installs?: Record<string, { sourcePath?: unknown }> } | undefined)?.installs?.devclaw?.sourcePath === "string"
      ? (pluginConfig as { installs?: Record<string, { sourcePath?: string }> }).installs?.devclaw?.sourcePath ?? null
      : null;
  const openclawConfigInstallPath =
    typeof (pluginConfig as { installs?: Record<string, { installPath?: unknown }> } | undefined)?.installs?.devclaw?.installPath === "string"
      ? (pluginConfig as { installs?: Record<string, { installPath?: string }> }).installs?.devclaw?.installPath ?? null
      : null;
  const openclawConfigInstallSourceRealPath = await tryRealpath(openclawConfigInstallSourcePath);
  const openclawConfigInstallPathRealPath = await tryRealpath(openclawConfigInstallPath);
  const openclawConfigPluginLoadPathRealPaths = await Promise.all(
    (openclawConfigPluginLoadPaths ?? []).map((pathValue) => tryRealpath(pathValue)),
  );
  const pluginSourceConfigSummary = summarizePluginSourceConfig({
    installSourceRealPath: openclawConfigInstallSourceRealPath,
    installPathRealPath: openclawConfigInstallPathRealPath,
    pluginLoadPathRealPaths: openclawConfigPluginLoadPathRealPaths,
    pluginRealPath: typeof pluginSnapshot.realRepoPath === "string" ? pluginSnapshot.realRepoPath : null,
  });
  const branchDecisionContext = {
    repoBranch: typeof repoSnapshot.branch === "string" ? repoSnapshot.branch : null,
    repoWorkTree: typeof repoSnapshot.workTree === "string" ? repoSnapshot.workTree : null,
    repoWorkTreeBasename: typeof repoSnapshot.workTree === "string" ? repoSnapshot.workTree.split("/").filter(Boolean).at(-1) ?? null : null,
    repoRealPath: typeof repoSnapshot.realRepoPath === "string" ? repoSnapshot.realRepoPath : null,
    repoDetachedHead: typeof repoSnapshot.branch !== "string" || !repoSnapshot.branch,
    repoHeadBranches: typeof repoSnapshot.headBranches === "string" ? repoSnapshot.headBranches.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    pluginBranch: typeof pluginSnapshot.branch === "string" ? pluginSnapshot.branch : null,
    pluginWorkTree: typeof pluginSnapshot.workTree === "string" ? pluginSnapshot.workTree : null,
    pluginWorkTreeBasename: typeof pluginSnapshot.workTree === "string" ? pluginSnapshot.workTree.split("/").filter(Boolean).at(-1) ?? null : null,
    pluginRealPath: typeof pluginSnapshot.realRepoPath === "string" ? pluginSnapshot.realRepoPath : null,
    pluginDetachedHead: typeof pluginSnapshot.branch !== "string" || !pluginSnapshot.branch,
    pluginHeadBranches: typeof pluginSnapshot.headBranches === "string" ? pluginSnapshot.headBranches.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    openclawConfigPluginLoadPaths,
    openclawConfigPluginLoadPathRealPaths,
    openclawConfigInstallSourcePath,
    openclawConfigInstallSourceRealPath,
    openclawConfigInstallPath,
    openclawConfigInstallPathRealPath,
    pluginSourceConfigSummary,
    duplicateSourceRisk: pluginSourceConfigSummary.duplicateSourceRisk,
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
            inferredBranchWinner:
              branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch
                ? "configured_repo_branch"
                : sourceBranch != null && branchDecisionContext.repoHeadBranches.includes(sourceBranch)
                  ? "configured_repo_head_branches"
                  : branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch
                    ? "live_plugin_branch"
                    : sourceBranch != null && branchDecisionContext.pluginHeadBranches.includes(sourceBranch)
                      ? "live_plugin_head_branches"
                      : branchDecisionContext.repoBranch !== null
                        ? "configured_repo_branch_fallback"
                        : branchDecisionContext.pluginBranch !== null
                          ? "live_plugin_branch_fallback"
                          : "no_branch_match",
            inferredBranchWinnerReason:
              branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch
                ? "configured repo branch directly matched the detected PR source branch"
                : sourceBranch != null && branchDecisionContext.repoHeadBranches.includes(sourceBranch)
                  ? "configured repo HEAD pointed at the detected PR source branch"
                  : branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch
                    ? "live plugin branch matched the detected PR source branch after configured repo branch failed to match"
                    : sourceBranch != null && branchDecisionContext.pluginHeadBranches.includes(sourceBranch)
                      ? "live plugin HEAD pointed at the detected PR source branch after configured repo branch candidates failed to match"
                      : branchDecisionContext.repoBranch !== null
                        ? "no PR-aware match existed, so configured repo branch would be used as fallback"
                        : branchDecisionContext.pluginBranch !== null
                          ? "no PR-aware configured repo match existed, so live plugin branch would be used as fallback"
                          : "neither configured repo nor live plugin exposed a trustworthy branch candidate",
            inferredBranchWinnerCategory:
              branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath !== branchDecisionContext.pluginRealPath
                ? "repo_plugin_realpath_mismatch"
                : branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch !== branchDecisionContext.pluginBranch
                  ? "repo_plugin_branch_mismatch"
                  : sourceBranch == null
                    ? "no_pr_source_branch"
                    : "pr_source_branch_resolved",
            branchDecisionNotes: [
              branchDecisionContext.repoWorkTree === branchDecisionContext.pluginWorkTree ? "repoPath and plugin source report the same worktree" : "repoPath and plugin source report different worktrees",
              branchDecisionContext.repoBranch === branchDecisionContext.pluginBranch ? "repoPath and plugin source report the same current branch" : "repoPath and plugin source report different current branches",
              branchDecisionContext.repoDetachedHead ? "repoPath snapshot looks detached or branch --show-current was empty" : "repoPath snapshot reports a named current branch",
              branchDecisionContext.pluginDetachedHead ? "plugin snapshot looks detached or branch --show-current was empty" : "plugin snapshot reports a named current branch",
              sourceBranch && branchDecisionContext.repoHeadBranches.includes(sourceBranch) ? "repo HEAD points at detected source branch" : "repo HEAD does not point at detected source branch",
              sourceBranch && branchDecisionContext.pluginHeadBranches.includes(sourceBranch) ? "plugin HEAD points at detected source branch" : "plugin HEAD does not point at detected source branch",
              branchDecisionContext.openclawConfigInstallSourcePath === branchDecisionContext.pluginWorkTree ? "OpenClaw install source path matches plugin worktree" : "OpenClaw install source path differs from plugin worktree",
              branchDecisionContext.openclawConfigInstallSourceRealPath === branchDecisionContext.pluginRealPath ? "OpenClaw install source realpath matches plugin realpath" : "OpenClaw install source realpath differs from plugin realpath",
              Array.isArray(branchDecisionContext.openclawConfigPluginLoadPaths) && branchDecisionContext.openclawConfigPluginLoadPaths.includes(branchDecisionContext.pluginWorkTree) ? "plugin worktree is present in plugins.load.paths" : "plugin worktree is missing from plugins.load.paths",
              Array.isArray(branchDecisionContext.openclawConfigPluginLoadPathRealPaths) && branchDecisionContext.openclawConfigPluginLoadPathRealPaths.includes(branchDecisionContext.pluginRealPath) ? "plugin realpath is present in plugins.load.paths realpaths" : "plugin realpath is missing from plugins.load.paths realpaths",
              branchDecisionContext.duplicateSourceRisk ? `duplicate source risk detected because config points at competing DevClaw realpaths: ${JSON.stringify(branchDecisionContext.pluginSourceConfigSummary)}` : "no duplicate source risk detected from plugin config paths",
            ],
            duplicateSourceDecision: branchDecisionContext.duplicateSourceRisk
              ? "live install evidence is ambiguous because multiple DevClaw realpaths are configured"
              : "live install evidence is singular or unresolved from config",
            liveSourceDecision:
              branchDecisionContext.openclawConfigInstallSourceRealPath && branchDecisionContext.pluginRealPath
                ? branchDecisionContext.openclawConfigInstallSourceRealPath === branchDecisionContext.pluginRealPath
                  ? "observed live plugin realpath matches configured install source realpath"
                  : "observed live plugin realpath differs from configured install source realpath"
                : "live-source comparison could not be completed because one of the realpaths was unavailable",
            branchSelectionCandidatesInPriorityOrder: [
              { source: "configured_repo_branch", value: branchDecisionContext.repoBranch, matchesSourceBranch: branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch },
              { source: "configured_repo_head_branches", value: branchDecisionContext.repoHeadBranches, matchesSourceBranch: sourceBranch != null && branchDecisionContext.repoHeadBranches.includes(sourceBranch) },
              { source: "live_plugin_branch", value: branchDecisionContext.pluginBranch, matchesSourceBranch: branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch },
              { source: "live_plugin_head_branches", value: branchDecisionContext.pluginHeadBranches, matchesSourceBranch: sourceBranch != null && branchDecisionContext.pluginHeadBranches.includes(sourceBranch) },
            ],
            duplicateSourceCompetingRealPaths: branchDecisionContext.pluginSourceConfigSummary.conflictingDevclawRealPaths,
            duplicateSourceWinningRealPathGuess: branchDecisionContext.pluginSourceConfigSummary.likelyWinningLiveRealPath,
            liveSourceSingularitySummary: branchDecisionContext.pluginSourceConfigSummary.duplicateSourceRisk
              ? `duplicate-source risk remains because config resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} distinct realpaths`
              : `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} singular realpath set(s) with no competing load path outside install source`,
            branchWinnerComparedToLaneSummary:
              sourceBranch == null
                ? "no PR source branch was available, so any branch winner would still be a fallback comparison against the configured lane and live plugin lane"
                : branchDecisionContext.pluginBranch == null
                  ? `PR source branch ${sourceBranch} was available but live plugin branch was unavailable, so comparison is limited to configured repo candidates`
                  : branchDecisionContext.pluginBranch === sourceBranch
                    ? `PR source branch ${sourceBranch} matches the live plugin branch, so branch inference agrees with the active lane`
                    : `PR source branch ${sourceBranch} differs from live plugin branch ${branchDecisionContext.pluginBranch}, so branch inference points away from the active lane`,
            laneMismatchCategory:
              branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath !== branchDecisionContext.pluginRealPath
                ? "repo_plugin_realpath_mismatch"
                : branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch !== branchDecisionContext.pluginBranch
                  ? "repo_plugin_branch_mismatch"
                  : "lane_aligned_or_unresolved",
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
    branchResolutionDecision: branchDecisionContext.branchResolutionDecision ?? null,
    branchResolutionPreferredSource: branchDecisionContext.preferredBranchSource ?? null,
    branchResolutionPreferredEvidence: branchDecisionContext.preferredBranchEvidence ?? null,
    preferredBranchConfidence: branchDecisionContext.preferredBranchConfidence ?? null,
    branchSelectionWinnerSummary: branchDecisionContext.branchSelectionWinnerSummary ?? null,
    branchWinnerDecisionSummary: branchDecisionContext.branchWinnerDecisionSummary ?? null,
    branchWinnerComparedToLaneSummary: branchDecisionContext.branchWinnerComparedToLaneSummary ?? null,
    openclawConfigInstallSourcePath: branchDecisionContext.openclawConfigInstallSourcePath ?? null,
    openclawConfigInstallSourceRealPath: branchDecisionContext.openclawConfigInstallSourceRealPath ?? null,
    openclawConfigInstallPath: branchDecisionContext.openclawConfigInstallPath ?? null,
    openclawConfigInstallPathRealPath: branchDecisionContext.openclawConfigInstallPathRealPath ?? null,
    openclawConfigPluginLoadPaths: branchDecisionContext.openclawConfigPluginLoadPaths ?? null,
    openclawConfigPluginLoadPathRealPaths: branchDecisionContext.openclawConfigPluginLoadPathRealPaths ?? null,
    branchResolutionMismatchFlags: {
      repoPathMatchesResolvedWorkTree: branchDecisionContext.repoWorkTree === repoPath,
      repoRealPathMatchesResolvedWorkTree: branchDecisionContext.repoRealPath === repoPath,
      pluginSourceMatchesResolvedWorkTree: branchDecisionContext.pluginWorkTree === pluginSourceRoot,
      pluginRealPathMatchesSourceRoot: branchDecisionContext.pluginRealPath === pluginSourceRoot,
      repoAndPluginSameWorkTree: branchDecisionContext.repoWorkTree !== null && branchDecisionContext.pluginWorkTree !== null && branchDecisionContext.repoWorkTree === branchDecisionContext.pluginWorkTree,
      repoAndPluginSameRealPath: branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath === branchDecisionContext.pluginRealPath,
      repoAndPluginSameBranch: branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch === branchDecisionContext.pluginBranch,
    },
    liveSourceAgreementMatrix: {
      installSourceMatchesInstalledPath: branchDecisionContext.pluginSourceConfigSummary.installSourceMatchesInstalledPath,
      installSourceMatchesLivePlugin: branchDecisionContext.pluginSourceConfigSummary.installSourceMatchesLivePlugin,
      installedPathMatchesLivePlugin: branchDecisionContext.pluginSourceConfigSummary.installedPathMatchesLivePlugin,
      pluginLoadPathsContainLivePlugin: branchDecisionContext.pluginSourceConfigSummary.pluginLoadPathsContainLivePlugin,
      pluginLoadPathsContainInstallSource: branchDecisionContext.pluginSourceConfigSummary.pluginLoadPathsContainInstallSource,
    },
    laneIdentitySummary: {
      configuredRepoPathBasename: typeof repoPath === "string" ? repoPath.split("/").filter(Boolean).at(-1) ?? null : null,
      pluginSourceRootBasename: pluginSourceRoot.split("/").filter(Boolean).at(-1) ?? null,
      configuredRepoBranch: branchDecisionContext.repoBranch ?? null,
      livePluginBranch: branchDecisionContext.pluginBranch ?? null,
      configuredRepoWorkTree: branchDecisionContext.repoWorkTree ?? null,
      livePluginWorkTree: branchDecisionContext.pluginWorkTree ?? null,
    },
    branchSelectionDecisionTrace: {
      preferredBranchSource: branchDecisionContext.preferredBranchSource ?? null,
      preferredBranchConfidence: branchDecisionContext.preferredBranchConfidence ?? null,
      branchWinner: branchDecisionContext.branchWinner ?? null,
      branchWinnerSourceKind: branchDecisionContext.branchWinnerSourceKind ?? null,
      preferredBranchUsedFallback: branchDecisionContext.preferredBranchUsedFallback ?? null,
      repoBranchMatchesSourceBranch: branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch,
      pluginBranchMatchesSourceBranch: branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch,
      repoHeadPointsAtSourceBranch: sourceBranch != null && branchDecisionContext.repoHeadBranches.includes(sourceBranch),
      pluginHeadPointsAtSourceBranch: sourceBranch != null && branchDecisionContext.pluginHeadBranches.includes(sourceBranch),
    },
    liveSourceDecision:
      branchDecisionContext.openclawConfigInstallSourceRealPath && branchDecisionContext.pluginRealPath
        ? branchDecisionContext.openclawConfigInstallSourceRealPath === branchDecisionContext.pluginRealPath
          ? "observed live plugin realpath matches configured install source realpath"
          : "observed live plugin realpath differs from configured install source realpath"
        : "live-source comparison could not be completed because one of the realpaths was unavailable",
    liveSourceSingularitySummary: branchDecisionContext.pluginSourceConfigSummary.duplicateSourceRisk
      ? `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} distinct realpaths, so duplicate-source risk remains active`
      : `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} singular realpath set(s) with no competing load path outside install source`,
    duplicateSourceDecision: branchDecisionContext.duplicateSourceRisk
      ? "transition is running with duplicate-source risk flagged in branch decision context"
      : "transition is running without duplicate-source risk in branch decision context",
    duplicateSourceWinningRealPathGuess: branchDecisionContext.pluginSourceConfigSummary.likelyWinningLiveRealPath ?? null,
    duplicateSourceCompetingRealPaths: branchDecisionContext.pluginSourceConfigSummary.conflictingDevclawRealPaths,
    branchSourceCandidateDecisionTable: branchDecisionContext.branchSourceCandidateDecisionTable,
    branchSourceCandidateDiagnostics: branchDecisionContext.branchSourceCandidateDiagnostics ?? null,
    branchSourceCandidatesInPriorityOrder: branchDecisionContext.branchSourceCandidatesInPriorityOrder ?? null,
    laneMismatchSummary: branchDecisionContext.branchMismatchSummary ?? null,
    laneMismatchCategory:
      branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath !== branchDecisionContext.pluginRealPath
        ? "repo_plugin_realpath_mismatch"
        : branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch !== branchDecisionContext.pluginBranch
          ? "repo_plugin_branch_mismatch"
          : "lane_aligned_or_unresolved",
    transitionReasonCategory: transitionedTo === "Refining"
      ? `work_finish_${result}`
      : transitionedTo === "To Review"
        ? "developer_done_to_review"
        : transitionedTo === "To Improve"
          ? "tester_fail_to_improve"
          : transitionedTo === "Done"
            ? `${role}_${result}_to_done`
            : `${role}_${result}_transition`,
    refiningDecisionPath: transitionedTo === "Refining"
      ? `completion rule ${key} routes directly to Refining because role=${role} result=${result} is defined as a human-intervention hold transition`
      : null,
    decisionPath: `completion rule ${key} selected workflow transition ${rule.from} -> ${transitionedTo}`,
    prValidationSummary,
    prValidationLookupOutcome: prValidationSummary?.lookupOutcome ?? null,
    prValidationDecision: prValidationSummary?.branchResolutionDecision ?? null,
    prValidationBranchWinnerDecisionSummary: prValidationSummary?.branchWinnerDecisionSummary ?? null,
    prValidationBranchSelectionWinnerSummary: prValidationSummary?.branchSelectionWinnerSummary ?? null,
    prValidationBranchWinnerComparedToLaneSummary: prValidationSummary?.branchWinnerComparedToLaneSummary ?? null,
    prValidationBranchResolutionPreferredSource: prValidationSummary?.preferredBranchSource ?? null,
    prValidationPreferredBranchConfidence: prValidationSummary?.preferredBranchConfidence ?? null,
    prValidationBranchResolutionPreferredEvidence: prValidationSummary?.branchResolutionPreferredEvidence ?? null,
    prValidationLookupTargetingDecision: prValidationSummary?.prLookupTargetingDecision ?? null,
    prValidationLookupTargetingSummary: prValidationSummary?.prLookupTargeting ?? null,
    prValidationConfiguredProviderTargetRepo: typeof prValidationSummary?.prLookupTargeting?.configuredProviderTargetRepo === "string" ? prValidationSummary.prLookupTargeting.configuredProviderTargetRepo : null,
    prValidationRepoAmbientGhTarget: typeof prValidationSummary?.prLookupTargeting?.repoAmbientGhTarget === "string" ? prValidationSummary.prLookupTargeting.repoAmbientGhTarget : null,
    prValidationPluginAmbientGhTarget: typeof prValidationSummary?.prLookupTargeting?.pluginAmbientGhTarget === "string" ? prValidationSummary.prLookupTargeting.pluginAmbientGhTarget : null,
    prValidationRepoAmbientLinkedPrCount: typeof prValidationSummary?.prLookupTargeting?.repoAmbientLinkedPrCount === "number" ? prValidationSummary.prLookupTargeting.repoAmbientLinkedPrCount : null,
    prValidationPluginAmbientLinkedPrCount: typeof prValidationSummary?.prLookupTargeting?.pluginAmbientLinkedPrCount === "number" ? prValidationSummary.prLookupTargeting.pluginAmbientLinkedPrCount : null,
    prValidationConfiguredTargetLinkedPrCount: typeof prValidationSummary?.prLookupTargeting?.configuredTargetLinkedPrCount === "number" ? prValidationSummary.prLookupTargeting.configuredTargetLinkedPrCount : null,
    prValidationLookupProbeDecision: prValidationSummary?.prLookupProbeDecision ?? null,
    prValidationLookupProbeSummary: prValidationSummary?.prLookupProbeSummary ?? null,
    prValidationDetectedBranch: prValidationSummary?.detectedBranch ?? null,
    prValidationDetectedBranchSource: prValidationSummary?.detectedBranchSource ?? null,
    prValidationDetectedBranchDecisionSummary: prValidationSummary?.detectedBranchDecisionSummary ?? null,
    prValidationDetectedBranchMismatchReasons: prValidationSummary?.detectedBranchMismatchReasons ?? null,
    prValidationBranchSourceCandidateDecisionTable: prValidationSummary?.branchSourceCandidateDecisionTable ?? null,
    prValidationBranchSourceCandidateDiagnostics: Array.isArray(prValidationSummary?.branchResolution?.branchSourceCandidateDiagnostics) ? prValidationSummary.branchResolution.branchSourceCandidateDiagnostics as Array<Record<string, unknown>> : null,
    prValidationBranchSourceCandidatesInPriorityOrder: prValidationSummary?.branchSourceCandidatesInPriorityOrder ?? null,
    prValidationLaneMismatchSummary: prValidationSummary?.branchMismatchSummary ?? null,
    prValidationLaneMismatchCategory: prValidationSummary?.laneMismatchCategory ?? null,

  }).catch(() => {});

  try {
    await provider.transitionLabel(issueId, rule.from as StateLabel, transitionedTo);
  } catch (err) {
    await recordLoopDiagnostic(workspaceDir, "work_finish_transition_failed", {
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
      branchResolutionPreferredSource: branchDecisionContext.preferredBranchSource ?? null,
      preferredBranchConfidence: branchDecisionContext.preferredBranchConfidence ?? null,
      branchSelectionWinnerSummary: branchDecisionContext.branchSelectionWinnerSummary ?? null,
      branchWinnerDecisionSummary: branchDecisionContext.branchWinnerDecisionSummary ?? null,
      branchWinnerComparedToLaneSummary: branchDecisionContext.branchWinnerComparedToLaneSummary ?? null,
      liveSourceDecision:
        branchDecisionContext.openclawConfigInstallSourceRealPath && branchDecisionContext.pluginRealPath
          ? branchDecisionContext.openclawConfigInstallSourceRealPath === branchDecisionContext.pluginRealPath
            ? "observed live plugin realpath matches configured install source realpath"
            : "observed live plugin realpath differs from configured install source realpath"
          : "live-source comparison could not be completed because one of the realpaths was unavailable",
      liveSourceSingularitySummary: branchDecisionContext.pluginSourceConfigSummary.duplicateSourceRisk
        ? `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} distinct realpaths, so duplicate-source risk remains active`
        : `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} singular realpath set(s) with no competing load path outside install source`,
      duplicateSourceDecision: branchDecisionContext.duplicateSourceRisk
        ? "transition failed while duplicate-source risk was flagged in branch decision context"
        : "transition failed without duplicate-source risk in branch decision context",
      duplicateSourceWinningRealPathGuess: branchDecisionContext.pluginSourceConfigSummary.likelyWinningLiveRealPath ?? null,
      duplicateSourceCompetingRealPaths: branchDecisionContext.pluginSourceConfigSummary.conflictingDevclawRealPaths,
      branchSourceCandidateDecisionTable: branchDecisionContext.branchSourceCandidateDecisionTable,
      branchSourceCandidateDiagnostics: branchDecisionContext.branchSourceCandidateDiagnostics ?? null,
      laneMismatchCategory:
        branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath !== branchDecisionContext.pluginRealPath
          ? "repo_plugin_realpath_mismatch"
          : branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch !== branchDecisionContext.pluginBranch
            ? "repo_plugin_branch_mismatch"
            : "lane_aligned_or_unresolved",
      error: (err as Error).message ?? String(err),
      errorName: err instanceof Error ? err.name : null,
      transitionReasonCategory: transitionedTo === "Refining"
        ? `work_finish_${result}`
        : transitionedTo === "To Review"
          ? "developer_done_to_review"
          : transitionedTo === "To Improve"
            ? "tester_fail_to_improve"
            : transitionedTo === "Done"
              ? `${role}_${result}_to_done`
              : `${role}_${result}_transition`,
      refiningDecisionPath: transitionedTo === "Refining"
        ? `completion rule ${key} would have routed to Refining because role=${role} result=${result} is a hold transition, but provider.transitionLabel failed`
        : null,
      decisionPath: `completion rule ${key} attempted workflow transition ${rule.from} -> ${transitionedTo}, but provider.transitionLabel threw before the transition could be recorded as complete`,
      prValidationSummary,
      prValidationLookupOutcome: prValidationSummary?.lookupOutcome ?? null,
      prValidationDecision: prValidationSummary?.branchResolutionDecision ?? null,
      prValidationBranchWinnerDecisionSummary: prValidationSummary?.branchWinnerDecisionSummary ?? null,
      prValidationBranchSelectionWinnerSummary: prValidationSummary?.branchSelectionWinnerSummary ?? null,
      prValidationBranchWinnerComparedToLaneSummary: prValidationSummary?.branchWinnerComparedToLaneSummary ?? null,
      prValidationBranchResolutionPreferredSource: prValidationSummary?.preferredBranchSource ?? null,
      prValidationPreferredBranchConfidence: prValidationSummary?.preferredBranchConfidence ?? null,
      prValidationBranchResolutionPreferredEvidence: prValidationSummary?.branchResolutionPreferredEvidence ?? null,
    prValidationLookupProbeDecision: prValidationSummary?.prLookupProbeDecision ?? null,
    prValidationLookupProbeSummary: prValidationSummary?.prLookupProbeSummary ?? null,
      prValidationDetectedBranch: prValidationSummary?.detectedBranch ?? null,
      prValidationDetectedBranchSource: prValidationSummary?.detectedBranchSource ?? null,
      prValidationDetectedBranchDecisionSummary: prValidationSummary?.detectedBranchDecisionSummary ?? null,
      prValidationDetectedBranchMismatchReasons: prValidationSummary?.detectedBranchMismatchReasons ?? null,
      prValidationBranchSourceCandidateDecisionTable: prValidationSummary?.branchSourceCandidateDecisionTable ?? null,
      prValidationBranchSourceCandidatesInPriorityOrder: prValidationSummary?.branchSourceCandidatesInPriorityOrder ?? null,
      prValidationLaneMismatchSummary: prValidationSummary?.branchMismatchSummary ?? null,
      prValidationLaneMismatchCategory: prValidationSummary?.laneMismatchCategory ?? null,

    }).catch(() => {});
    throw err;
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
    branchResolutionDecision: branchDecisionContext.branchResolutionDecision ?? null,
    branchResolutionPreferredSource: branchDecisionContext.preferredBranchSource ?? null,
    branchResolutionPreferredEvidence: branchDecisionContext.preferredBranchEvidence ?? null,
    preferredBranchConfidence: branchDecisionContext.preferredBranchConfidence ?? null,
    branchSelectionWinnerSummary: branchDecisionContext.branchSelectionWinnerSummary ?? null,
    branchWinnerDecisionSummary: branchDecisionContext.branchWinnerDecisionSummary ?? null,
    branchWinnerComparedToLaneSummary: branchDecisionContext.branchWinnerComparedToLaneSummary ?? null,
    openclawConfigInstallSourcePath: branchDecisionContext.openclawConfigInstallSourcePath ?? null,
    openclawConfigInstallSourceRealPath: branchDecisionContext.openclawConfigInstallSourceRealPath ?? null,
    openclawConfigInstallPath: branchDecisionContext.openclawConfigInstallPath ?? null,
    openclawConfigInstallPathRealPath: branchDecisionContext.openclawConfigInstallPathRealPath ?? null,
    openclawConfigPluginLoadPaths: branchDecisionContext.openclawConfigPluginLoadPaths ?? null,
    openclawConfigPluginLoadPathRealPaths: branchDecisionContext.openclawConfigPluginLoadPathRealPaths ?? null,
    branchResolutionMismatchFlags: {
      repoPathMatchesResolvedWorkTree: branchDecisionContext.repoWorkTree === repoPath,
      repoRealPathMatchesResolvedWorkTree: branchDecisionContext.repoRealPath === repoPath,
      pluginSourceMatchesResolvedWorkTree: branchDecisionContext.pluginWorkTree === pluginSourceRoot,
      pluginRealPathMatchesSourceRoot: branchDecisionContext.pluginRealPath === pluginSourceRoot,
      repoAndPluginSameWorkTree: branchDecisionContext.repoWorkTree !== null && branchDecisionContext.pluginWorkTree !== null && branchDecisionContext.repoWorkTree === branchDecisionContext.pluginWorkTree,
      repoAndPluginSameRealPath: branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath === branchDecisionContext.pluginRealPath,
      repoAndPluginSameBranch: branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch === branchDecisionContext.pluginBranch,
    },
    liveSourceAgreementMatrix: {
      installSourceMatchesInstalledPath: branchDecisionContext.pluginSourceConfigSummary.installSourceMatchesInstalledPath,
      installSourceMatchesLivePlugin: branchDecisionContext.pluginSourceConfigSummary.installSourceMatchesLivePlugin,
      installedPathMatchesLivePlugin: branchDecisionContext.pluginSourceConfigSummary.installedPathMatchesLivePlugin,
      pluginLoadPathsContainLivePlugin: branchDecisionContext.pluginSourceConfigSummary.pluginLoadPathsContainLivePlugin,
      pluginLoadPathsContainInstallSource: branchDecisionContext.pluginSourceConfigSummary.pluginLoadPathsContainInstallSource,
    },
    laneIdentitySummary: {
      configuredRepoPathBasename: typeof repoPath === "string" ? repoPath.split("/").filter(Boolean).at(-1) ?? null : null,
      pluginSourceRootBasename: pluginSourceRoot.split("/").filter(Boolean).at(-1) ?? null,
      configuredRepoBranch: branchDecisionContext.repoBranch ?? null,
      livePluginBranch: branchDecisionContext.pluginBranch ?? null,
      configuredRepoWorkTree: branchDecisionContext.repoWorkTree ?? null,
      livePluginWorkTree: branchDecisionContext.pluginWorkTree ?? null,
    },
    branchSelectionDecisionTrace: {
      preferredBranchSource: branchDecisionContext.preferredBranchSource ?? null,
      preferredBranchConfidence: branchDecisionContext.preferredBranchConfidence ?? null,
      branchWinner: branchDecisionContext.branchWinner ?? null,
      branchWinnerSourceKind: branchDecisionContext.branchWinnerSourceKind ?? null,
      preferredBranchUsedFallback: branchDecisionContext.preferredBranchUsedFallback ?? null,
      repoBranchMatchesSourceBranch: branchDecisionContext.repoBranch !== null && sourceBranch != null && branchDecisionContext.repoBranch === sourceBranch,
      pluginBranchMatchesSourceBranch: branchDecisionContext.pluginBranch !== null && sourceBranch != null && branchDecisionContext.pluginBranch === sourceBranch,
      repoHeadPointsAtSourceBranch: sourceBranch != null && branchDecisionContext.repoHeadBranches.includes(sourceBranch),
      pluginHeadPointsAtSourceBranch: sourceBranch != null && branchDecisionContext.pluginHeadBranches.includes(sourceBranch),
    },
    liveSourceDecision:
      branchDecisionContext.openclawConfigInstallSourceRealPath && branchDecisionContext.pluginRealPath
        ? branchDecisionContext.openclawConfigInstallSourceRealPath === branchDecisionContext.pluginRealPath
          ? "observed live plugin realpath matches configured install source realpath"
          : "observed live plugin realpath differs from configured install source realpath"
        : "live-source comparison could not be completed because one of the realpaths was unavailable",
    liveSourceSingularitySummary: branchDecisionContext.pluginSourceConfigSummary.duplicateSourceRisk
      ? `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} distinct realpaths, so duplicate-source risk remains active`
      : `config currently resolves DevClaw to ${branchDecisionContext.pluginSourceConfigSummary.distinctDevclawRealPathCount} singular realpath set(s) with no competing load path outside install source`,
    duplicateSourceDecision: branchDecisionContext.duplicateSourceRisk
      ? "transition completed while duplicate-source risk was flagged in branch decision context"
      : "transition completed without duplicate-source risk in branch decision context",
    duplicateSourceWinningRealPathGuess: branchDecisionContext.pluginSourceConfigSummary.likelyWinningLiveRealPath ?? null,
    duplicateSourceCompetingRealPaths: branchDecisionContext.pluginSourceConfigSummary.conflictingDevclawRealPaths,
    branchSourceCandidateDecisionTable: branchDecisionContext.branchSourceCandidateDecisionTable,
    branchSourceCandidateDiagnostics: branchDecisionContext.branchSourceCandidateDiagnostics ?? null,
    branchSourceCandidatesInPriorityOrder: branchDecisionContext.branchSourceCandidatesInPriorityOrder ?? null,
    laneMismatchSummary: branchDecisionContext.branchMismatchSummary ?? null,
    laneMismatchCategory:
      branchDecisionContext.repoRealPath !== null && branchDecisionContext.pluginRealPath !== null && branchDecisionContext.repoRealPath !== branchDecisionContext.pluginRealPath
        ? "repo_plugin_realpath_mismatch"
        : branchDecisionContext.repoBranch !== null && branchDecisionContext.pluginBranch !== null && branchDecisionContext.repoBranch !== branchDecisionContext.pluginBranch
          ? "repo_plugin_branch_mismatch"
          : "lane_aligned_or_unresolved",
    transitionReasonCategory: transitionedTo === "Refining"
      ? `work_finish_${result}`
      : transitionedTo === "To Review"
        ? "developer_done_to_review"
        : transitionedTo === "To Improve"
          ? "tester_fail_to_improve"
          : transitionedTo === "Done"
            ? `${role}_${result}_to_done`
            : `${role}_${result}_transition`,
    refiningDecisionPath: transitionedTo === "Refining"
      ? `completion rule ${key} completed a direct hold transition into Refining because role=${role} result=${result} requires human intervention`
      : null,
    decisionPath: `completion rule ${key} completed workflow transition ${rule.from} -> ${transitionedTo}`,
    prValidationSummary,
    prValidationLookupOutcome: prValidationSummary?.lookupOutcome ?? null,
    prValidationDecision: prValidationSummary?.branchResolutionDecision ?? null,
    prValidationBranchWinnerDecisionSummary: prValidationSummary?.branchWinnerDecisionSummary ?? null,
    prValidationBranchSelectionWinnerSummary: prValidationSummary?.branchSelectionWinnerSummary ?? null,
    prValidationBranchWinnerComparedToLaneSummary: prValidationSummary?.branchWinnerComparedToLaneSummary ?? null,
    prValidationBranchResolutionPreferredSource: prValidationSummary?.preferredBranchSource ?? null,
    prValidationPreferredBranchConfidence: prValidationSummary?.preferredBranchConfidence ?? null,
    prValidationBranchResolutionPreferredEvidence: prValidationSummary?.branchResolutionPreferredEvidence ?? null,
    prValidationLookupTargetingDecision: prValidationSummary?.prLookupTargetingDecision ?? null,
    prValidationLookupTargetingSummary: prValidationSummary?.prLookupTargeting ?? null,
    prValidationConfiguredProviderTargetRepo: typeof prValidationSummary?.prLookupTargeting?.configuredProviderTargetRepo === "string" ? prValidationSummary.prLookupTargeting.configuredProviderTargetRepo : null,
    prValidationRepoAmbientGhTarget: typeof prValidationSummary?.prLookupTargeting?.repoAmbientGhTarget === "string" ? prValidationSummary.prLookupTargeting.repoAmbientGhTarget : null,
    prValidationPluginAmbientGhTarget: typeof prValidationSummary?.prLookupTargeting?.pluginAmbientGhTarget === "string" ? prValidationSummary.prLookupTargeting.pluginAmbientGhTarget : null,
    prValidationRepoAmbientLinkedPrCount: typeof prValidationSummary?.prLookupTargeting?.repoAmbientLinkedPrCount === "number" ? prValidationSummary.prLookupTargeting.repoAmbientLinkedPrCount : null,
    prValidationPluginAmbientLinkedPrCount: typeof prValidationSummary?.prLookupTargeting?.pluginAmbientLinkedPrCount === "number" ? prValidationSummary.prLookupTargeting.pluginAmbientLinkedPrCount : null,
    prValidationConfiguredTargetLinkedPrCount: typeof prValidationSummary?.prLookupTargeting?.configuredTargetLinkedPrCount === "number" ? prValidationSummary.prLookupTargeting.configuredTargetLinkedPrCount : null,
    prValidationLookupProbeDecision: prValidationSummary?.prLookupProbeDecision ?? null,
    prValidationLookupProbeSummary: prValidationSummary?.prLookupProbeSummary ?? null,
    prValidationDetectedBranch: prValidationSummary?.detectedBranch ?? null,
    prValidationDetectedBranchSource: prValidationSummary?.detectedBranchSource ?? null,
    prValidationDetectedBranchDecisionSummary: prValidationSummary?.detectedBranchDecisionSummary ?? null,
    prValidationDetectedBranchMismatchReasons: prValidationSummary?.detectedBranchMismatchReasons ?? null,
    prValidationBranchSourceCandidateDecisionTable: prValidationSummary?.branchSourceCandidateDecisionTable ?? null,
    prValidationBranchSourceCandidateDiagnostics: Array.isArray(prValidationSummary?.branchResolution?.branchSourceCandidateDiagnostics) ? prValidationSummary.branchResolution.branchSourceCandidateDiagnostics as Array<Record<string, unknown>> : null,
    prValidationBranchSourceCandidatesInPriorityOrder: prValidationSummary?.branchSourceCandidatesInPriorityOrder ?? null,
    prValidationLaneMismatchSummary: prValidationSummary?.branchMismatchSummary ?? null,
    prValidationLaneMismatchCategory: prValidationSummary?.laneMismatchCategory ?? null,

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
