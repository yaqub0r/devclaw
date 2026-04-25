/**
 * work_finish — Complete a task (DEV done, QA pass/fail/refine/blocked, architect done/blocked).
 *
 * Delegates side-effects to pipeline service: label transition, state update,
 * issue close/reopen, notifications, and audit logging.
 *
 * All roles (including architect) use the standard pipeline via executeCompletion.
 * Architect workflow: Researching → Done (done, closes issue), Researching → Refining (blocked).
 */
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolContext } from "../../types.js";
import type { PluginContext, RunCommand } from "../../context.js";
import { getRoleWorker, resolveRepoPath, findSlotByIssue } from "../../projects/index.js";
import { executeCompletion, getRule } from "../../services/pipeline.js";
import { log as auditLog } from "../../audit.js";
import { DATA_DIR } from "../../setup/migrate-layout.js";
import { jsonResult, normalizeRepoTarget, requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";
import { getAllRoleIds, isValidResult, getCompletionResults } from "../../roles/index.js";
import { loadWorkflow } from "../../workflow/index.js";

/**
 * Get the current git branch name.
 */
async function getCurrentBranch(repoPath: string, runCommand: RunCommand): Promise<string> {
  const result = await runCommand(["git", "branch", "--show-current"], {
    timeoutMs: 5_000,
    cwd: repoPath,
  });
  return result.stdout.trim();
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
    ["remotes", ["git", "remote", "-v"]],
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

function getPluginSourceRoot(): string {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

function getPluginSourceDerivation(): Record<string, unknown> {
  const moduleFilePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(moduleFilePath);
  const selectedPluginSourceRoot = getPluginSourceRoot();
  const candidateRoots = [
    { label: "dirname^0", path: moduleDir },
    { label: "dirname^1", path: dirname(moduleDir) },
    { label: "dirname^2", path: dirname(dirname(moduleDir)) },
    { label: "dirname^3", path: dirname(dirname(dirname(moduleDir))) },
    { label: "dirname^4(selected)", path: selectedPluginSourceRoot },
    { label: "dirname^5", path: dirname(selectedPluginSourceRoot) },
  ];

  return {
    moduleImportUrl: import.meta.url,
    moduleFilePath,
    moduleDir,
    selectedPluginSourceRoot,
    selectionRule: "work_finish uses dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))) as pluginSourceRoot",
    candidateRoots,
  };
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

function buildBranchResolutionDiagnostic(opts: {
  repoPath: string;
  pluginSourceRoot: string;
  repoSnapshot: Record<string, unknown>;
  pluginSnapshot: Record<string, unknown>;
  prSourceBranch?: string | null;
}): Record<string, unknown> {
  const repoBranch = typeof opts.repoSnapshot.branch === "string" ? opts.repoSnapshot.branch : null;
  const repoWorkTree = typeof opts.repoSnapshot.workTree === "string" ? opts.repoSnapshot.workTree : null;
  const pluginBranch = typeof opts.pluginSnapshot.branch === "string" ? opts.pluginSnapshot.branch : null;
  const pluginWorkTree = typeof opts.pluginSnapshot.workTree === "string" ? opts.pluginSnapshot.workTree : null;
  const prSourceBranch = opts.prSourceBranch ?? null;

  const repoHeadBranches = typeof opts.repoSnapshot.headBranches === "string"
    ? opts.repoSnapshot.headBranches.split("\n").map((s) => s.trim()).filter(Boolean)
    : [];
  const pluginHeadBranches = typeof opts.pluginSnapshot.headBranches === "string"
    ? opts.pluginSnapshot.headBranches.split("\n").map((s) => s.trim()).filter(Boolean)
    : [];
  const repoRealPath = typeof opts.repoSnapshot.realRepoPath === "string" ? opts.repoSnapshot.realRepoPath : null;
  const pluginRealPath = typeof opts.pluginSnapshot.realRepoPath === "string" ? opts.pluginSnapshot.realRepoPath : null;
  const repoHead = typeof opts.repoSnapshot.head === "string" ? opts.repoSnapshot.head : null;
  const pluginHead = typeof opts.pluginSnapshot.head === "string" ? opts.pluginSnapshot.head : null;
  const repoDetachedHead = repoBranch === null || repoBranch.length === 0;
  const pluginDetachedHead = pluginBranch === null || pluginBranch.length === 0;
  const repoWorkTreeBasename = repoWorkTree ? repoWorkTree.split("/").filter(Boolean).at(-1) ?? null : null;
  const pluginWorkTreeBasename = pluginWorkTree ? pluginWorkTree.split("/").filter(Boolean).at(-1) ?? null : null;
  const configuredRepoPathBasename = opts.repoPath.split("/").filter(Boolean).at(-1) ?? null;
  const pluginSourceRootBasename = opts.pluginSourceRoot.split("/").filter(Boolean).at(-1) ?? null;
  const preferredBranchSource =
    repoBranch !== null && prSourceBranch !== null && repoBranch === prSourceBranch
      ? "configured_repo_branch"
      : repoHeadBranches.includes(prSourceBranch ?? "")
        ? "configured_repo_head_branches"
        : pluginBranch !== null && prSourceBranch !== null && pluginBranch === prSourceBranch
          ? "live_plugin_branch"
          : pluginHeadBranches.includes(prSourceBranch ?? "")
            ? "live_plugin_head_branches"
            : repoBranch !== null
              ? "configured_repo_branch_fallback"
              : pluginBranch !== null
                ? "live_plugin_branch_fallback"
                : "no_branch_match";
  const preferredBranchUsedFallback = preferredBranchSource === "configured_repo_branch_fallback" || preferredBranchSource === "live_plugin_branch_fallback";
  const preferredBranchConfidence =
    preferredBranchSource === "configured_repo_branch" || preferredBranchSource === "live_plugin_branch"
      ? "direct_pr_branch_match"
      : preferredBranchSource === "configured_repo_head_branches" || preferredBranchSource === "live_plugin_head_branches"
        ? "head_points_at_pr_branch"
        : preferredBranchUsedFallback
          ? "fallback_without_pr_match"
          : "no_trustworthy_match";
  const branchWinner =
    preferredBranchSource === "configured_repo_branch" || preferredBranchSource === "configured_repo_branch_fallback"
      ? repoBranch
      : preferredBranchSource === "configured_repo_head_branches"
        ? prSourceBranch
        : preferredBranchSource === "live_plugin_branch" || preferredBranchSource === "live_plugin_branch_fallback"
          ? pluginBranch
          : preferredBranchSource === "live_plugin_head_branches"
            ? prSourceBranch
            : null;
  const branchWinnerSourceKind = preferredBranchSource.startsWith("configured_repo")
    ? "configured_repo"
    : preferredBranchSource.startsWith("live_plugin")
      ? "live_plugin"
      : "none";
  const branchWinnerMatchesRepoBranch = branchWinner !== null && repoBranch !== null && branchWinner === repoBranch;
  const branchWinnerMatchesPluginBranch = branchWinner !== null && pluginBranch !== null && branchWinner === pluginBranch;
  const branchWinnerMatchesRepoWorkTreeBasename = branchWinner !== null && repoWorkTreeBasename !== null && branchWinner === repoWorkTreeBasename;
  const branchWinnerMatchesPluginWorkTreeBasename = branchWinner !== null && pluginWorkTreeBasename !== null && branchWinner === pluginWorkTreeBasename;
  const branchWinnerMatchesConfiguredRepoPathBasename = branchWinner !== null && configuredRepoPathBasename !== null && branchWinner === configuredRepoPathBasename;
  const branchWinnerMatchesPluginSourceRootBasename = branchWinner !== null && pluginSourceRootBasename !== null && branchWinner === pluginSourceRootBasename;
  const branchWinnerLooksSuspicious = Boolean(
    (configuredRepoPathBasename && repoBranch && configuredRepoPathBasename !== repoBranch)
    || (pluginSourceRootBasename && pluginBranch && pluginSourceRootBasename !== pluginBranch)
    || (branchWinnerSourceKind === "configured_repo" && repoBranch && pluginBranch && repoBranch !== pluginBranch)
    || (branchWinnerSourceKind === "configured_repo" && repoRealPath !== null && pluginRealPath !== null && repoRealPath !== pluginRealPath)
    || (branchWinner !== null && pluginBranch !== null && branchWinner !== pluginBranch)
    || (branchWinner !== null && pluginWorkTreeBasename !== null && branchWinner !== pluginWorkTreeBasename)
    || preferredBranchUsedFallback,
  );
  const branchWinnerSuspicionReasons = [
    configuredRepoPathBasename && repoBranch && configuredRepoPathBasename !== repoBranch
      ? `configured repo path basename ${configuredRepoPathBasename} differs from configured repo branch ${repoBranch}`
      : null,
    pluginSourceRootBasename && pluginBranch && pluginSourceRootBasename !== pluginBranch
      ? `live plugin source basename ${pluginSourceRootBasename} differs from live plugin branch ${pluginBranch}`
      : null,
    branchWinnerSourceKind === "configured_repo" && repoBranch && pluginBranch && repoBranch !== pluginBranch
      ? `configured repo branch ${repoBranch} beat live plugin branch ${pluginBranch}`
      : null,
    branchWinnerSourceKind === "configured_repo" && repoRealPath !== null && pluginRealPath !== null && repoRealPath !== pluginRealPath
      ? `configured repo realpath ${repoRealPath} differs from live plugin realpath ${pluginRealPath} even though configured repo won branch selection`
      : null,
    branchWinner !== null && pluginBranch !== null && branchWinner !== pluginBranch
      ? `branch winner ${branchWinner} differs from live plugin branch ${pluginBranch}`
      : null,
    branchWinner !== null && pluginWorkTreeBasename !== null && branchWinner !== pluginWorkTreeBasename
      ? `branch winner ${branchWinner} differs from live plugin worktree basename ${pluginWorkTreeBasename}`
      : null,
    preferredBranchUsedFallback
      ? `branch winner ${preferredBranchSource} relied on fallback selection because no PR-aware match was available`
      : null,
  ].filter((value): value is string => Boolean(value));

  const branchWinnerComparedToLaneSummary =
    branchWinner === null
      ? "no branch winner was available to compare against the configured lane or live plugin lane"
      : [
          branchWinnerMatchesRepoBranch ? `winner matches configured repo branch ${repoBranch}` : repoBranch ? `winner differs from configured repo branch ${repoBranch}` : "configured repo branch unavailable",
          branchWinnerMatchesPluginBranch ? `winner matches live plugin branch ${pluginBranch}` : pluginBranch ? `winner differs from live plugin branch ${pluginBranch}` : "live plugin branch unavailable",
          branchWinnerMatchesConfiguredRepoPathBasename ? `winner matches configured repo path basename ${configuredRepoPathBasename}` : configuredRepoPathBasename ? `winner differs from configured repo path basename ${configuredRepoPathBasename}` : "configured repo path basename unavailable",
          branchWinnerMatchesPluginSourceRootBasename ? `winner matches live plugin source basename ${pluginSourceRootBasename}` : pluginSourceRootBasename ? `winner differs from live plugin source basename ${pluginSourceRootBasename}` : "live plugin source basename unavailable",
        ].join("; ");

  return {
    repoBranch,
    repoWorkTree,
    repoRealPath,
    repoHead,
    repoHeadBranches,
    pluginBranch,
    pluginWorkTree,
    pluginRealPath,
    pluginHead,
    pluginHeadBranches,
    prSourceBranch,
    repoPathMatchesResolvedWorkTree: repoWorkTree === opts.repoPath,
    repoRealPathMatchesResolvedWorkTree: repoRealPath === opts.repoPath,
    pluginSourceMatchesResolvedWorkTree: pluginWorkTree === opts.pluginSourceRoot,
    pluginRealPathMatchesSourceRoot: pluginRealPath === opts.pluginSourceRoot,
    repoAndPluginSameWorkTree: repoWorkTree !== null && pluginWorkTree !== null && repoWorkTree === pluginWorkTree,
    repoAndPluginSameRealPath: repoRealPath !== null && pluginRealPath !== null && repoRealPath === pluginRealPath,
    repoAndPluginSameBranch: repoBranch !== null && pluginBranch !== null && repoBranch === pluginBranch,
    repoHeadMatchesCurrentBranch: repoBranch !== null && repoHeadBranches.includes(repoBranch),
    pluginHeadMatchesCurrentBranch: pluginBranch !== null && pluginHeadBranches.includes(pluginBranch),
    repoHeadMatchesPluginBranch: pluginBranch !== null && repoHeadBranches.includes(pluginBranch),
    pluginHeadMatchesRepoBranch: repoBranch !== null && pluginHeadBranches.includes(repoBranch),
    repoBranchMatchesPrSourceBranch: repoBranch !== null && prSourceBranch !== null && repoBranch === prSourceBranch,
    pluginBranchMatchesPrSourceBranch: pluginBranch !== null && prSourceBranch !== null && pluginBranch === prSourceBranch,
    repoHeadPointsAtPrSourceBranch: prSourceBranch !== null && repoHeadBranches.includes(prSourceBranch),
    pluginHeadPointsAtPrSourceBranch: prSourceBranch !== null && pluginHeadBranches.includes(prSourceBranch),
    repoDetachedHead,
    pluginDetachedHead,
    repoWorkTreeBasename,
    pluginWorkTreeBasename,
    configuredRepoPathBasename,
    pluginSourceRootBasename,
    preferredBranchSource,
    preferredBranchUsedFallback,
    preferredBranchConfidence,
    branchWinner,
    branchWinnerSourceKind,
    branchWinnerMatchesRepoBranch,
    branchWinnerMatchesPluginBranch,
    branchWinnerMatchesRepoWorkTreeBasename,
    branchWinnerMatchesPluginWorkTreeBasename,
    branchWinnerMatchesConfiguredRepoPathBasename,
    branchWinnerMatchesPluginSourceRootBasename,
    branchWinnerLooksSuspicious,
    branchWinnerSuspicionReasons,
    branchWinnerComparedToLaneSummary,
    preferredBranchEvidence:
      preferredBranchSource === "configured_repo_branch"
        ? "configured repo branch directly matched PR source branch"
        : preferredBranchSource === "configured_repo_head_branches"
          ? "configured repo HEAD points at PR source branch even though branch --show-current did not"
          : preferredBranchSource === "live_plugin_branch"
            ? "live plugin branch directly matched PR source branch while configured repo branch did not"
            : preferredBranchSource === "live_plugin_head_branches"
              ? "live plugin HEAD points at PR source branch even though branch --show-current did not"
              : preferredBranchSource === "configured_repo_branch_fallback"
                ? "no PR-aware match existed, so configured repo branch became fallback"
                : preferredBranchSource === "live_plugin_branch_fallback"
                  ? "no PR-aware match existed and configured repo branch was unavailable, so live plugin branch became fallback"
                  : "no branch source matched or could be trusted",
    branchMismatchSummary: [
      repoWorkTree === opts.repoPath ? "configured repo worktree matches resolved repo path" : "configured repo worktree differs from resolved repo path",
      pluginWorkTree === opts.pluginSourceRoot ? "live plugin worktree matches resolved plugin source root" : "live plugin worktree differs from resolved plugin source root",
      repoRealPath !== null && pluginRealPath !== null && repoRealPath === pluginRealPath ? "configured repo and live plugin share a realpath" : "configured repo and live plugin resolve to different realpaths",
      repoBranch !== null && pluginBranch !== null && repoBranch === pluginBranch ? "configured repo and live plugin report the same branch" : "configured repo and live plugin report different branches or one side is detached",
      repoDetachedHead ? "configured repo appears detached or branch --show-current was empty" : "configured repo reports a named current branch",
      pluginDetachedHead ? "live plugin appears detached or branch --show-current was empty" : "live plugin reports a named current branch",
    ],
    branchSourceCandidatesInPriorityOrder: [
      { source: "configured_repo_branch", value: repoBranch, matchesPrSourceBranch: repoBranch !== null && prSourceBranch !== null && repoBranch === prSourceBranch, priority: 1 },
      { source: "configured_repo_head_branches", value: repoHeadBranches, matchesPrSourceBranch: prSourceBranch !== null && repoHeadBranches.includes(prSourceBranch), priority: 2 },
      { source: "live_plugin_branch", value: pluginBranch, matchesPrSourceBranch: pluginBranch !== null && prSourceBranch !== null && pluginBranch === prSourceBranch, priority: 3 },
      { source: "live_plugin_head_branches", value: pluginHeadBranches, matchesPrSourceBranch: prSourceBranch !== null && pluginHeadBranches.includes(prSourceBranch), priority: 4 },
    ],
    branchSelectionWinnerSummary:
      preferredBranchSource === "configured_repo_branch"
        ? `configured repo branch ${repoBranch} won because it directly matched PR source branch ${prSourceBranch}`
        : preferredBranchSource === "configured_repo_head_branches"
          ? `configured repo HEAD branches ${JSON.stringify(repoHeadBranches)} won because they included PR source branch ${prSourceBranch}`
          : preferredBranchSource === "live_plugin_branch"
            ? `live plugin branch ${pluginBranch} won because configured repo candidates did not match PR source branch ${prSourceBranch}`
            : preferredBranchSource === "live_plugin_head_branches"
              ? `live plugin HEAD branches ${JSON.stringify(pluginHeadBranches)} won because configured repo candidates did not match PR source branch ${prSourceBranch}`
              : preferredBranchSource === "configured_repo_branch_fallback"
                ? `configured repo branch ${repoBranch} won as fallback because no PR-aware candidate matched`
                : preferredBranchSource === "live_plugin_branch_fallback"
                  ? `live plugin branch ${pluginBranch} won as fallback because configured repo branch was unavailable and no PR-aware candidate matched`
                  : "no trustworthy branch winner could be identified",
    branchWinnerDecisionSummary:
      branchWinner === null
        ? "no branch winner could be derived from configured repo, live plugin, or PR source state"
        : branchWinnerLooksSuspicious
          ? `branch winner ${branchWinner} from ${preferredBranchSource} looks suspicious: ${branchWinnerSuspicionReasons.join("; ")}`
          : `branch winner ${branchWinner} from ${preferredBranchSource} looks consistent with the active lane evidence`,
    branchSourceCandidateDiagnostics: [
      {
        source: "configured_repo_branch",
        value: repoBranch,
        head: repoHead,
        realPath: repoRealPath,
        matchesPrSourceBranch: repoBranch !== null && prSourceBranch !== null && repoBranch === prSourceBranch,
        selected: preferredBranchSource === "configured_repo_branch",
        disqualifiedBecause:
          preferredBranchSource === "configured_repo_branch"
            ? null
            : repoBranch === null
              ? "configured repo branch was unavailable or detached"
              : prSourceBranch === null
                ? "PR source branch was unavailable, so direct PR-aware matching could not select configured repo branch"
                : repoBranch !== prSourceBranch
                  ? `configured repo branch ${repoBranch} did not match PR source branch ${prSourceBranch}`
                  : "configured repo branch was outranked by a higher-confidence candidate",
      },
      {
        source: "configured_repo_head_branches",
        value: repoHeadBranches,
        head: repoHead,
        realPath: repoRealPath,
        matchesPrSourceBranch: prSourceBranch !== null && repoHeadBranches.includes(prSourceBranch),
        selected: preferredBranchSource === "configured_repo_head_branches",
        disqualifiedBecause:
          preferredBranchSource === "configured_repo_head_branches"
            ? null
            : repoHeadBranches.length === 0
              ? "configured repo HEAD had no named branches pointing at it"
              : prSourceBranch === null
                ? "PR source branch was unavailable, so detached-HEAD branch candidates could not be matched"
                : !repoHeadBranches.includes(prSourceBranch)
                  ? `configured repo HEAD branches ${JSON.stringify(repoHeadBranches)} did not include PR source branch ${prSourceBranch}`
                  : "configured repo HEAD candidate was outranked by a higher-confidence candidate",
      },
      {
        source: "live_plugin_branch",
        value: pluginBranch,
        head: pluginHead,
        realPath: pluginRealPath,
        matchesPrSourceBranch: pluginBranch !== null && prSourceBranch !== null && pluginBranch === prSourceBranch,
        selected: preferredBranchSource === "live_plugin_branch",
        disqualifiedBecause:
          preferredBranchSource === "live_plugin_branch"
            ? null
            : pluginBranch === null
              ? "live plugin branch was unavailable or detached"
              : prSourceBranch === null
                ? "PR source branch was unavailable, so live plugin direct matching could not be selected"
                : pluginBranch !== prSourceBranch
                  ? `live plugin branch ${pluginBranch} did not match PR source branch ${prSourceBranch}`
                  : "live plugin branch lost to a higher-priority configured repo candidate",
      },
      {
        source: "live_plugin_head_branches",
        value: pluginHeadBranches,
        head: pluginHead,
        realPath: pluginRealPath,
        matchesPrSourceBranch: prSourceBranch !== null && pluginHeadBranches.includes(prSourceBranch),
        selected: preferredBranchSource === "live_plugin_head_branches",
        disqualifiedBecause:
          preferredBranchSource === "live_plugin_head_branches"
            ? null
            : pluginHeadBranches.length === 0
              ? "live plugin HEAD had no named branches pointing at it"
              : prSourceBranch === null
                ? "PR source branch was unavailable, so live plugin detached-HEAD candidates could not be matched"
                : !pluginHeadBranches.includes(prSourceBranch)
                  ? `live plugin HEAD branches ${JSON.stringify(pluginHeadBranches)} did not include PR source branch ${prSourceBranch}`
                  : "live plugin HEAD candidate lost to a higher-priority configured repo candidate",
      },
    ],
    branchSourceCandidateDecisionTable: [
      {
        source: "configured_repo_branch",
        priority: 1,
        candidateValue: repoBranch,
        candidateHead: repoHead,
        candidateRealPath: repoRealPath,
        prSourceBranch,
        selectedWinner: preferredBranchSource === "configured_repo_branch",
        candidateStatus: preferredBranchSource === "configured_repo_branch" ? "winner" : repoBranch === null ? "missing" : prSourceBranch === null ? "unverifiable_without_pr_source" : repoBranch === prSourceBranch ? "matched_but_outranked" : "mismatch",
        outrankedBy: preferredBranchSource === "configured_repo_branch" || repoBranch === null || (prSourceBranch !== null && repoBranch !== prSourceBranch) ? null : preferredBranchSource,
        selectionRule: "prefer configured repo branch when it directly matches PR source branch",
      },
      {
        source: "configured_repo_head_branches",
        priority: 2,
        candidateValue: repoHeadBranches,
        candidateHead: repoHead,
        candidateRealPath: repoRealPath,
        prSourceBranch,
        selectedWinner: preferredBranchSource === "configured_repo_head_branches",
        candidateStatus: preferredBranchSource === "configured_repo_head_branches" ? "winner" : repoHeadBranches.length === 0 ? "missing" : prSourceBranch === null ? "unverifiable_without_pr_source" : repoHeadBranches.includes(prSourceBranch) ? "matched_but_outranked" : "mismatch",
        outrankedBy: preferredBranchSource === "configured_repo_head_branches" || repoHeadBranches.length === 0 || (prSourceBranch !== null && !repoHeadBranches.includes(prSourceBranch)) ? null : preferredBranchSource,
        selectionRule: "otherwise prefer configured repo HEAD-attached branch names when HEAD points at PR source branch",
      },
      {
        source: "live_plugin_branch",
        priority: 3,
        candidateValue: pluginBranch,
        candidateHead: pluginHead,
        candidateRealPath: pluginRealPath,
        prSourceBranch,
        selectedWinner: preferredBranchSource === "live_plugin_branch",
        candidateStatus: preferredBranchSource === "live_plugin_branch" ? "winner" : pluginBranch === null ? "missing" : prSourceBranch === null ? "unverifiable_without_pr_source" : pluginBranch === prSourceBranch ? "matched_but_outranked" : "mismatch",
        outrankedBy: preferredBranchSource === "live_plugin_branch" || pluginBranch === null || (prSourceBranch !== null && pluginBranch !== prSourceBranch) ? null : preferredBranchSource,
        selectionRule: "otherwise prefer live plugin branch when configured repo candidates did not match and live plugin branch matches PR source branch",
      },
      {
        source: "live_plugin_head_branches",
        priority: 4,
        candidateValue: pluginHeadBranches,
        candidateHead: pluginHead,
        candidateRealPath: pluginRealPath,
        prSourceBranch,
        selectedWinner: preferredBranchSource === "live_plugin_head_branches",
        candidateStatus: preferredBranchSource === "live_plugin_head_branches" ? "winner" : pluginHeadBranches.length === 0 ? "missing" : prSourceBranch === null ? "unverifiable_without_pr_source" : pluginHeadBranches.includes(prSourceBranch) ? "matched_but_outranked" : "mismatch",
        outrankedBy: preferredBranchSource === "live_plugin_head_branches" || pluginHeadBranches.length === 0 || (prSourceBranch !== null && !pluginHeadBranches.includes(prSourceBranch)) ? null : preferredBranchSource,
        selectionRule: "otherwise prefer live plugin HEAD-attached branch names when they point at PR source branch",
      },
    ],
  };
}

function summarizeDetectedBranchSource(opts: {
  detectedBranch: string | null;
  branchResolution: Record<string, unknown>;
}): Record<string, unknown> {
  const detectedBranch = opts.detectedBranch;
  const branchWinner = typeof opts.branchResolution.branchWinner === "string" ? opts.branchResolution.branchWinner : null;
  const preferredBranchSource = typeof opts.branchResolution.preferredBranchSource === "string" ? opts.branchResolution.preferredBranchSource : null;
  const repoBranch = typeof opts.branchResolution.repoBranch === "string" ? opts.branchResolution.repoBranch : null;
  const pluginBranch = typeof opts.branchResolution.pluginBranch === "string" ? opts.branchResolution.pluginBranch : null;
  const prSourceBranch = typeof opts.branchResolution.prSourceBranch === "string" ? opts.branchResolution.prSourceBranch : null;
  const repoHeadBranches = Array.isArray(opts.branchResolution.repoHeadBranches)
    ? opts.branchResolution.repoHeadBranches.filter((value): value is string => typeof value === "string")
    : [];
  const pluginHeadBranches = Array.isArray(opts.branchResolution.pluginHeadBranches)
    ? opts.branchResolution.pluginHeadBranches.filter((value): value is string => typeof value === "string")
    : [];

  const detectedBranchSource =
    detectedBranch === null
      ? "missing"
      : repoBranch !== null && detectedBranch === repoBranch
        ? "configured_repo_branch"
        : pluginBranch !== null && detectedBranch === pluginBranch
          ? "live_plugin_branch"
          : prSourceBranch !== null && detectedBranch === prSourceBranch
            ? "pr_source_branch"
            : repoHeadBranches.includes(detectedBranch)
              ? "configured_repo_head_branches"
              : pluginHeadBranches.includes(detectedBranch)
                ? "live_plugin_head_branches"
                : branchWinner !== null && detectedBranch === branchWinner
                  ? "branch_resolution_winner"
                  : "unexpected_or_unclassified";

  const mismatchReasons = [
    detectedBranch !== null && branchWinner !== null && detectedBranch !== branchWinner
      ? `detected branch ${detectedBranch} differs from branch-resolution winner ${branchWinner}`
      : null,
    detectedBranch !== null && repoBranch !== null && detectedBranch !== repoBranch
      ? `detected branch ${detectedBranch} differs from configured repo branch ${repoBranch}`
      : null,
    detectedBranch !== null && pluginBranch !== null && detectedBranch !== pluginBranch
      ? `detected branch ${detectedBranch} differs from live plugin branch ${pluginBranch}`
      : null,
    detectedBranch !== null && prSourceBranch !== null && detectedBranch !== prSourceBranch
      ? `detected branch ${detectedBranch} differs from PR source branch ${prSourceBranch}`
      : null,
    detectedBranch !== null && preferredBranchSource !== null && detectedBranchSource === "unexpected_or_unclassified"
      ? `detected branch ${detectedBranch} could not be explained by preferred branch source ${preferredBranchSource}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    detectedBranch,
    detectedBranchSource,
    detectedBranchMatchesBranchWinner: detectedBranch !== null && branchWinner !== null ? detectedBranch === branchWinner : null,
    detectedBranchMatchesConfiguredRepoBranch: detectedBranch !== null && repoBranch !== null ? detectedBranch === repoBranch : null,
    detectedBranchMatchesLivePluginBranch: detectedBranch !== null && pluginBranch !== null ? detectedBranch === pluginBranch : null,
    detectedBranchMatchesPrSourceBranch: detectedBranch !== null && prSourceBranch !== null ? detectedBranch === prSourceBranch : null,
    detectedBranchMismatchReasons: mismatchReasons,
    detectedBranchDecisionSummary:
      detectedBranch === null
        ? "detected branch lookup returned no branch name"
        : detectedBranchSource === "configured_repo_branch"
          ? `detected branch ${detectedBranch} came directly from the configured repo branch`
          : detectedBranchSource === "live_plugin_branch"
            ? `detected branch ${detectedBranch} matches the live plugin branch`
            : detectedBranchSource === "pr_source_branch"
              ? `detected branch ${detectedBranch} matches the PR source branch`
              : detectedBranchSource === "configured_repo_head_branches"
                ? `detected branch ${detectedBranch} appears among configured repo HEAD-attached branches`
                : detectedBranchSource === "live_plugin_head_branches"
                  ? `detected branch ${detectedBranch} appears among live plugin HEAD-attached branches`
                  : detectedBranchSource === "branch_resolution_winner"
                    ? `detected branch ${detectedBranch} matches the branch-resolution winner ${branchWinner}`
                    : `detected branch ${detectedBranch} could not be cleanly explained by repo, plugin, or PR branch evidence`,
  };
}

async function recordWorkFinishDiagnostic(
  workspaceDir: string,
  stage: string,
  data: Record<string, unknown>,
): Promise<void> {
  await auditLog(workspaceDir, "loop_diagnostic", {
    stage,
    ...data,
  });
}

async function probeGhIssueLookup(opts: {
  issueId: number;
  cwd: string;
  runCommand: RunCommand;
  forcedRepo?: string | null;
  probeName: string;
}): Promise<Record<string, unknown>> {
  const args = [
    "gh",
    "issue",
    "view",
    String(opts.issueId),
    "--json",
    "number,state,repository,linkedPullRequests",
  ];
  if (opts.forcedRepo) args.push("--repo", opts.forcedRepo);

  try {
    const result = await opts.runCommand(args, { timeoutMs: 15_000, cwd: opts.cwd });
    const raw = result.stdout.trim();
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const linkedPullRequests = Array.isArray(parsed.linkedPullRequests) ? parsed.linkedPullRequests : [];
    const linkedPrHeads = linkedPullRequests
      .map((pr) => {
        if (!pr || typeof pr !== "object") return null;
        const headRefName = typeof (pr as { headRefName?: unknown }).headRefName === "string" ? (pr as { headRefName: string }).headRefName : null;
        const url = typeof (pr as { url?: unknown }).url === "string" ? (pr as { url: string }).url : null;
        const state = typeof (pr as { state?: unknown }).state === "string" ? (pr as { state: string }).state : null;
        return { headRefName, url, state };
      })
      .filter((pr): pr is { headRefName: string | null; url: string | null; state: string | null } => pr !== null);
    const repository = parsed.repository && typeof parsed.repository === "object" ? parsed.repository as Record<string, unknown> : null;
    const repositoryNameWithOwner = repository && typeof repository.nameWithOwner === "string" ? repository.nameWithOwner : null;

    return {
      probeName: opts.probeName,
      cwd: opts.cwd,
      forcedRepo: opts.forcedRepo ?? null,
      ok: true,
      exitCode: result.code ?? 0,
      repositoryNameWithOwner,
      linkedPullRequestCount: linkedPullRequests.length,
      linkedPullRequestHeads: linkedPrHeads,
    };
  } catch (err) {
    return {
      probeName: opts.probeName,
      cwd: opts.cwd,
      forcedRepo: opts.forcedRepo ?? null,
      ok: false,
      error: (err as Error).message ?? String(err),
    };
  }
}

type WorkFinishPrValidationSummary = {
  lookupOutcome: "pr_found" | "pr_missing" | "conflict_cycle_verified" | "conflict_cycle_rejected" | "validation_warning";
  prUrl: string | null;
  prState: string | null;
  prSourceBranch: string | null;
  prMergeable: boolean | null;
  detectedBranch?: string | null;
  detectedBranchSource?: string | null;
  detectedBranchDecisionSummary?: string | null;
  detectedBranchMismatchReasons?: string[] | null;
  prLookupTargeting?: Record<string, unknown>;
  prLookupTargetingDecision?: string;
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
};

/**
 * Check if this work_finish is completing a conflict resolution cycle.
 * Returns true if the issue was recently transitioned to "To Improve" due to merge conflicts.
 * Used to gate mergeable-status validation — without this check, developers can claim
 * success after local rebase but before pushing, causing infinite dispatch loops (#482).
 */
async function isConflictResolutionCycle(
  workspaceDir: string,
  issueId: number,
): Promise<boolean> {
  const auditPath = join(workspaceDir, DATA_DIR, "log", "audit.log");
  try {
    const content = await readFile(auditPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    // Walk backwards through recent entries
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]!);
        if (
          entry.issueId === issueId &&
          entry.event === "review_transition" &&
          entry.reason === "merge_conflict"
        ) {
          return true;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // If we can't read the audit log, fail open (assume not a conflict cycle)
  }
  return false;
}

/**
 * Validate that a developer has created a PR for their work.
 * Throws an error if no open (or merged) PR is found for the issue.
 *
 * How getPrStatus signals "no PR":
 *   - Returns `{ url: null }` when no open or merged PR is linked to the issue.
 *   - `url` is non-null for every found PR (open, approved, merged, etc.).
 *   - We check `url === null` rather than the state field to be explicit:
 *     a null URL unambiguously means "nothing found", regardless of state label.
 */
async function validatePrExistsForDeveloper(
  issueId: number,
  repoPath: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>["provider"],
  runCommand: RunCommand,
  workspaceDir: string,
  projectSlug: string,
  configuredProviderTargetRepo: string | null,
  context: Record<string, unknown> = {},
): Promise<WorkFinishPrValidationSummary | null> {
  try {
    const repoSnapshot = await getGitSnapshot(repoPath, runCommand);
    const pluginSourceRoot = getPluginSourceRoot();
    const pluginSnapshot = await getGitSnapshot(pluginSourceRoot, runCommand);
    const prStatus = await provider.getPrStatus(issueId);

    const branchResolution = buildBranchResolutionDiagnostic({
      repoPath,
      pluginSourceRoot,
      repoSnapshot,
      pluginSnapshot,
      prSourceBranch: prStatus.sourceBranch ?? null,
    });
    const repoAmbientGhTarget = typeof repoSnapshot.ghRepoView === "string" ? repoSnapshot.ghRepoView : null;
    const pluginAmbientGhTarget = typeof pluginSnapshot.ghRepoView === "string" ? pluginSnapshot.ghRepoView : null;
    const [repoAmbientIssueProbe, pluginAmbientIssueProbe, configuredTargetIssueProbe] = await Promise.all([
      probeGhIssueLookup({ issueId, cwd: repoPath, runCommand, probeName: "repo_ambient" }),
      probeGhIssueLookup({ issueId, cwd: pluginSourceRoot, runCommand, probeName: "plugin_ambient" }),
      configuredProviderTargetRepo
        ? probeGhIssueLookup({ issueId, cwd: repoPath, runCommand, forcedRepo: configuredProviderTargetRepo, probeName: "configured_target" })
        : Promise.resolve({
          probeName: "configured_target",
          cwd: repoPath,
          forcedRepo: null,
          ok: false,
          skipped: true,
          reason: "no_configured_provider_target_repo",
        } as Record<string, unknown>),
    ]);
    const repoAmbientLinkedPrCount = typeof repoAmbientIssueProbe.linkedPullRequestCount === "number" ? repoAmbientIssueProbe.linkedPullRequestCount : null;
    const pluginAmbientLinkedPrCount = typeof pluginAmbientIssueProbe.linkedPullRequestCount === "number" ? pluginAmbientIssueProbe.linkedPullRequestCount : null;
    const configuredTargetLinkedPrCount = typeof configuredTargetIssueProbe.linkedPullRequestCount === "number" ? configuredTargetIssueProbe.linkedPullRequestCount : null;
    const prLookupProbeDecision = configuredProviderTargetRepo
      ? configuredTargetLinkedPrCount !== null && repoAmbientLinkedPrCount !== null && configuredTargetLinkedPrCount !== repoAmbientLinkedPrCount
        ? `configured target lookup found ${configuredTargetLinkedPrCount} linked PR(s) while repo ambient lookup found ${repoAmbientLinkedPrCount}`
        : configuredTargetLinkedPrCount !== null && pluginAmbientLinkedPrCount !== null && configuredTargetLinkedPrCount !== pluginAmbientLinkedPrCount
          ? `configured target lookup found ${configuredTargetLinkedPrCount} linked PR(s) while live-plugin ambient lookup found ${pluginAmbientLinkedPrCount}`
          : "configured target and ambient issue-view probes did not disagree on linked PR count"
      : "no configured provider target repo, so only ambient issue-view probes were available";
    const prLookupTargetingDecision = configuredProviderTargetRepo
      ? repoAmbientGhTarget && repoAmbientGhTarget !== configuredProviderTargetRepo
        ? `provider PR lookup is pinned to configured target ${configuredProviderTargetRepo} even though ambient gh target at repoPath is ${repoAmbientGhTarget}`
        : pluginAmbientGhTarget && pluginAmbientGhTarget !== configuredProviderTargetRepo
          ? `provider PR lookup is pinned to configured target ${configuredProviderTargetRepo} even though ambient gh target at live plugin path is ${pluginAmbientGhTarget}`
          : `provider PR lookup is pinned to configured target ${configuredProviderTargetRepo}`
      : repoAmbientGhTarget || pluginAmbientGhTarget
        ? `provider PR lookup has no configured target override, so ambient gh target will be used (${repoAmbientGhTarget ?? pluginAmbientGhTarget})`
        : "provider PR lookup target could not be confirmed from configured target or ambient gh repo view";
    const prLookupTargeting = {
      configuredProviderTargetRepo,
      repoAmbientGhTarget,
      pluginAmbientGhTarget,
      repoAmbientMatchesConfiguredTarget: configuredProviderTargetRepo ? repoAmbientGhTarget === configuredProviderTargetRepo : null,
      pluginAmbientMatchesConfiguredTarget: configuredProviderTargetRepo ? pluginAmbientGhTarget === configuredProviderTargetRepo : null,
      repoAndPluginAmbientGhAgree: repoAmbientGhTarget && pluginAmbientGhTarget ? repoAmbientGhTarget === pluginAmbientGhTarget : null,
      repoAmbientIssueProbe,
      pluginAmbientIssueProbe,
      configuredTargetIssueProbe,
      repoAmbientLinkedPrCount,
      pluginAmbientLinkedPrCount,
      configuredTargetLinkedPrCount,
      probeDecision: prLookupProbeDecision,
      decision: prLookupTargetingDecision,
    };

    const validationSummary: WorkFinishPrValidationSummary = {
      lookupOutcome: "pr_found",
      prUrl: prStatus.url ?? null,
      prState: prStatus.state ?? null,
      prSourceBranch: prStatus.sourceBranch ?? null,
      prMergeable: typeof prStatus.mergeable === "boolean" ? prStatus.mergeable : null,
      prLookupTargeting,
      prLookupTargetingDecision,
      prLookupProbeDecision,
      prLookupProbeSummary: {
        repoAmbientIssueProbe,
        pluginAmbientIssueProbe,
        configuredTargetIssueProbe,
      },
      isConflictCycle: null,
      branchResolution,
      branchResolutionDecision:
        branchResolution.repoBranchMatchesPrSourceBranch === true
          ? "repo branch matches PR source branch"
          : branchResolution.repoHeadPointsAtPrSourceBranch === true
            ? "repo HEAD points at PR source branch even though branch --show-current did not match"
            : branchResolution.pluginBranchMatchesPrSourceBranch === true
              ? "plugin branch matches PR source branch but configured repo branch does not"
              : branchResolution.pluginHeadPointsAtPrSourceBranch === true
                ? "plugin HEAD points at PR source branch even though branch --show-current did not match"
                : "neither configured repo branch nor plugin branch matches PR source branch",
      branchResolutionPreferredSource: typeof branchResolution.preferredBranchSource === "string" ? branchResolution.preferredBranchSource : null,
      preferredBranchSource: typeof branchResolution.preferredBranchSource === "string" ? branchResolution.preferredBranchSource : null,
      preferredBranchConfidence: typeof branchResolution.preferredBranchConfidence === "string" ? branchResolution.preferredBranchConfidence : null,
      branchResolutionPreferredEvidence: typeof branchResolution.preferredBranchEvidence === "string" ? branchResolution.preferredBranchEvidence : null,
      branchWinnerDecisionSummary: typeof branchResolution.branchWinnerDecisionSummary === "string" ? branchResolution.branchWinnerDecisionSummary : null,
      branchSelectionWinnerSummary: typeof branchResolution.branchSelectionWinnerSummary === "string" ? branchResolution.branchSelectionWinnerSummary : null,
      branchWinnerComparedToLaneSummary: typeof branchResolution.branchWinnerComparedToLaneSummary === "string" ? branchResolution.branchWinnerComparedToLaneSummary : null,
      branchSourceCandidateDecisionTable: Array.isArray(branchResolution.branchSourceCandidateDecisionTable) ? branchResolution.branchSourceCandidateDecisionTable as Array<Record<string, unknown>> : null,
      branchSourceCandidatesInPriorityOrder: Array.isArray(branchResolution.branchSourceCandidatesInPriorityOrder) ? branchResolution.branchSourceCandidatesInPriorityOrder as Array<Record<string, unknown>> : null,
      branchMismatchSummary: Array.isArray(branchResolution.branchMismatchSummary) ? branchResolution.branchMismatchSummary.filter((value): value is string => typeof value === "string") : null,
      laneMismatchCategory: typeof branchResolution.repoRealPath === "string" && typeof branchResolution.pluginRealPath === "string" && branchResolution.repoRealPath !== branchResolution.pluginRealPath
        ? "repo_plugin_realpath_mismatch"
        : typeof branchResolution.repoBranch === "string" && typeof branchResolution.pluginBranch === "string" && branchResolution.repoBranch !== branchResolution.pluginBranch
          ? "repo_plugin_branch_mismatch"
          : "lane_aligned_or_unresolved",
    };

    await recordWorkFinishDiagnostic(workspaceDir, "work_finish_pr_validation", {
      project: projectSlug,
      issueId,
      ...context,
      repoSnapshot,
      pluginSourceRoot,
      pluginSnapshot,
      prUrl: prStatus.url ?? null,
      prState: prStatus.state,
      prSourceBranch: prStatus.sourceBranch ?? null,
      prMergeable: prStatus.mergeable ?? null,
      prLookupTargeting,
      prLookupTargetingDecision,
      branchResolution,
      branchResolutionDecision:
        branchResolution.repoBranchMatchesPrSourceBranch === true
          ? "repo branch matches PR source branch"
          : branchResolution.repoHeadPointsAtPrSourceBranch === true
            ? "repo HEAD points at PR source branch even though branch --show-current did not match"
            : branchResolution.pluginBranchMatchesPrSourceBranch === true
              ? "plugin branch matches PR source branch but configured repo branch does not"
              : branchResolution.pluginHeadPointsAtPrSourceBranch === true
                ? "plugin HEAD points at PR source branch even though branch --show-current did not match"
                : "neither configured repo branch nor plugin branch matches PR source branch",
      branchResolutionPreferredSource: typeof branchResolution.preferredBranchSource === "string" ? branchResolution.preferredBranchSource : null,
      preferredBranchSource: typeof branchResolution.preferredBranchSource === "string" ? branchResolution.preferredBranchSource : null,
      preferredBranchConfidence: typeof branchResolution.preferredBranchConfidence === "string" ? branchResolution.preferredBranchConfidence : null,
      branchResolutionPreferredEvidence: typeof branchResolution.preferredBranchEvidence === "string" ? branchResolution.preferredBranchEvidence : null,
      branchWinnerDecisionSummary: typeof branchResolution.branchWinnerDecisionSummary === "string" ? branchResolution.branchWinnerDecisionSummary : null,
      branchSelectionWinnerSummary: typeof branchResolution.branchSelectionWinnerSummary === "string" ? branchResolution.branchSelectionWinnerSummary : null,
      branchWinnerComparedToLaneSummary: typeof branchResolution.branchWinnerComparedToLaneSummary === "string" ? branchResolution.branchWinnerComparedToLaneSummary : null,
      branchSourceCandidateDecisionTable: Array.isArray(branchResolution.branchSourceCandidateDecisionTable) ? branchResolution.branchSourceCandidateDecisionTable as Array<Record<string, unknown>> : null,
      branchSourceCandidateDiagnostics: Array.isArray(branchResolution.branchSourceCandidateDiagnostics) ? branchResolution.branchSourceCandidateDiagnostics as Array<Record<string, unknown>> : null,
      branchSourceCandidatesInPriorityOrder: Array.isArray(branchResolution.branchSourceCandidatesInPriorityOrder) ? branchResolution.branchSourceCandidatesInPriorityOrder as Array<Record<string, unknown>> : null,
      laneMismatchSummary: Array.isArray(branchResolution.branchMismatchSummary) ? branchResolution.branchMismatchSummary.filter((value): value is string => typeof value === "string") : null,
      laneMismatchCategory: typeof branchResolution.repoRealPath === "string" && typeof branchResolution.pluginRealPath === "string" && branchResolution.repoRealPath !== branchResolution.pluginRealPath
        ? "repo_plugin_realpath_mismatch"
        : typeof branchResolution.repoBranch === "string" && typeof branchResolution.pluginBranch === "string" && branchResolution.repoBranch !== branchResolution.pluginBranch
          ? "repo_plugin_branch_mismatch"
          : "lane_aligned_or_unresolved",
      branchResolutionNotes: [
        branchResolution.repoAndPluginSameWorkTree === true ? "repo and plugin resolve to the same worktree" : "repo and plugin resolve to different worktrees",
        branchResolution.repoAndPluginSameBranch === true ? "repo and plugin report the same current branch" : "repo and plugin report different current branches",
        branchResolution.repoAndPluginSameRealPath === true ? "repo and plugin realpaths are the same" : "repo and plugin realpaths differ",
      ],
    }).catch(() => {});

    // url is null when getPrStatus found no open or merged PR for this issue.
    // This covers both "no PR ever created" and "PR was closed without merging".
    if (!prStatus.url) {
      // Get current branch for a helpful gh pr create example
      let branchName = "current-branch";
      try {
        branchName = await getCurrentBranch(repoPath, runCommand);
      } catch {
        // Fall back to generic placeholder
      }

      const missingPrBranchResolution = buildBranchResolutionDiagnostic({
        repoPath,
        pluginSourceRoot,
        repoSnapshot,
        pluginSnapshot,
        prSourceBranch: null,
      });
      const detectedBranchSummary = summarizeDetectedBranchSource({
        detectedBranch: branchName,
        branchResolution: missingPrBranchResolution,
      });
      validationSummary.detectedBranch = branchName;
      validationSummary.detectedBranchSource = typeof detectedBranchSummary.detectedBranchSource === "string" ? detectedBranchSummary.detectedBranchSource : null;
      validationSummary.detectedBranchDecisionSummary = typeof detectedBranchSummary.detectedBranchDecisionSummary === "string" ? detectedBranchSummary.detectedBranchDecisionSummary : null;
      validationSummary.detectedBranchMismatchReasons = Array.isArray(detectedBranchSummary.detectedBranchMismatchReasons)
        ? detectedBranchSummary.detectedBranchMismatchReasons.filter((value): value is string => typeof value === "string")
        : null;

      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_pr_missing", {
        project: projectSlug,
        issueId,
        ...context,
        repoSnapshot,
        pluginSourceRoot,
        pluginSnapshot,
        detectedBranch: branchName,
        ...detectedBranchSummary,
        branchResolution: missingPrBranchResolution,
        branchResolutionPreferredSource: typeof missingPrBranchResolution.preferredBranchSource === "string" ? missingPrBranchResolution.preferredBranchSource : null,
        preferredBranchSource: typeof missingPrBranchResolution.preferredBranchSource === "string" ? missingPrBranchResolution.preferredBranchSource : null,
        preferredBranchConfidence: typeof missingPrBranchResolution.preferredBranchConfidence === "string" ? missingPrBranchResolution.preferredBranchConfidence : null,
        branchResolutionPreferredEvidence: typeof missingPrBranchResolution.preferredBranchEvidence === "string" ? missingPrBranchResolution.preferredBranchEvidence : null,
        branchWinnerDecisionSummary: typeof missingPrBranchResolution.branchWinnerDecisionSummary === "string" ? missingPrBranchResolution.branchWinnerDecisionSummary : null,
        branchSelectionWinnerSummary: typeof missingPrBranchResolution.branchSelectionWinnerSummary === "string" ? missingPrBranchResolution.branchSelectionWinnerSummary : null,
        branchWinnerComparedToLaneSummary: typeof missingPrBranchResolution.branchWinnerComparedToLaneSummary === "string" ? missingPrBranchResolution.branchWinnerComparedToLaneSummary : null,
        branchSourceCandidateDecisionTable: Array.isArray(missingPrBranchResolution.branchSourceCandidateDecisionTable) ? missingPrBranchResolution.branchSourceCandidateDecisionTable as Array<Record<string, unknown>> : null,
        branchSourceCandidateDiagnostics: Array.isArray(missingPrBranchResolution.branchSourceCandidateDiagnostics) ? missingPrBranchResolution.branchSourceCandidateDiagnostics as Array<Record<string, unknown>> : null,
        branchSourceCandidatesInPriorityOrder: Array.isArray(missingPrBranchResolution.branchSourceCandidatesInPriorityOrder) ? missingPrBranchResolution.branchSourceCandidatesInPriorityOrder as Array<Record<string, unknown>> : null,
        laneMismatchSummary: Array.isArray(missingPrBranchResolution.branchMismatchSummary) ? missingPrBranchResolution.branchMismatchSummary.filter((value): value is string => typeof value === "string") : null,
        laneMismatchCategory: typeof missingPrBranchResolution.repoRealPath === "string" && typeof missingPrBranchResolution.pluginRealPath === "string" && missingPrBranchResolution.repoRealPath !== missingPrBranchResolution.pluginRealPath
          ? "repo_plugin_realpath_mismatch"
          : typeof missingPrBranchResolution.repoBranch === "string" && typeof missingPrBranchResolution.pluginBranch === "string" && missingPrBranchResolution.repoBranch !== missingPrBranchResolution.pluginBranch
            ? "repo_plugin_branch_mismatch"
            : "lane_aligned_or_unresolved",
        prLookupTargeting,
        prLookupTargetingDecision,
      }).catch(() => {});

      validationSummary.lookupOutcome = "pr_missing";
      throw new Error(
        `Cannot mark work_finish(done) without an open PR.\n\n` +
        `✗ No PR found for branch: ${branchName}\n\n` +
        `Please create a PR first:\n` +
        `  gh pr create --base main --head ${branchName} --title "..." --body "..."\n\n` +
        `Then call work_finish again.`,
      );
    }

    // url is set — an open or merged PR exists and is linked to this issue.
    // getPrStatus locates PRs via the issue tracker's linked-PR API, so any
    // non-null url already implies the PR references the issue.

    // Mark PR as "seen" (with eyes emoji) if not already marked.
    // This helps distinguish system-created PRs from human responses.
    // Best-effort — don't block completion if this fails.
    try {
      const hasEyes = await provider.prHasReaction(issueId, "eyes");
      if (!hasEyes) {
        await provider.reactToPr(issueId, "eyes");
      }
    } catch {
      // Ignore errors — marking is cosmetic
    }

    // Conflict resolution validation: When an issue returns from "To Improve" due to
    // merge conflicts, we must verify the PR is actually mergeable before accepting
    // work_finish(done). Without this check, developers can claim success after local
    // rebase but before pushing, causing infinite dispatch loops (#482).
    const isConflictCycle = await isConflictResolutionCycle(workspaceDir, issueId);
    validationSummary.isConflictCycle = isConflictCycle;

    await recordWorkFinishDiagnostic(workspaceDir, "work_finish_conflict_cycle_check", {
      project: projectSlug,
      issueId,
      ...context,
      isConflictCycle,
      prUrl: prStatus.url ?? null,
      prSourceBranch: prStatus.sourceBranch ?? null,
      prMergeable: prStatus.mergeable ?? null,
      prLookupTargeting,
      prLookupTargetingDecision,
      repoSnapshot,
      pluginSourceRoot,
      pluginSnapshot,
      branchResolution,
      conflictCycleDecision: isConflictCycle
        ? "issue was previously moved by review_transition merge_conflict, so mergeable must be true before accepting done"
        : "no merge_conflict review_transition found in audit log, so mergeable gate is not enforced",
    }).catch(() => {});

    if (isConflictCycle && prStatus.mergeable === false) {
      await auditLog(workspaceDir, "work_finish_rejected", {
        project: projectSlug,
        issue: issueId,
        reason: "pr_still_conflicting",
        prUrl: prStatus.url,
      });

      const branchName = prStatus.sourceBranch || "your-branch";
      const detectedBranchSummary = summarizeDetectedBranchSource({
        detectedBranch: branchName,
        branchResolution,
      });
      validationSummary.lookupOutcome = "conflict_cycle_rejected";
      validationSummary.detectedBranch = branchName;
      validationSummary.detectedBranchSource = typeof detectedBranchSummary.detectedBranchSource === "string" ? detectedBranchSummary.detectedBranchSource : null;
      validationSummary.detectedBranchDecisionSummary = typeof detectedBranchSummary.detectedBranchDecisionSummary === "string" ? detectedBranchSummary.detectedBranchDecisionSummary : null;
      validationSummary.detectedBranchMismatchReasons = Array.isArray(detectedBranchSummary.detectedBranchMismatchReasons)
        ? detectedBranchSummary.detectedBranchMismatchReasons.filter((value): value is string => typeof value === "string")
        : null;
      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_conflict_rejected", {
        project: projectSlug,
        issueId,
        ...context,
        prUrl: prStatus.url ?? null,
        prSourceBranch: prStatus.sourceBranch ?? null,
        detectedBranch: branchName,
        ...detectedBranchSummary,
        prMergeable: prStatus.mergeable ?? null,
        prLookupTargeting,
        prLookupTargetingDecision,
        repoSnapshot,
        pluginSourceRoot,
        pluginSnapshot,
        branchResolution,
      }).catch(() => {});
      throw new Error(
        `Cannot complete work_finish(done) while PR still shows merge conflicts.\n\n` +
        `✗ PR status: CONFLICTING\n` +
        `✗ PR URL: ${prStatus.url}\n` +
        `✗ Branch: ${branchName}\n\n` +
        `Your local rebase may have succeeded, but changes must be pushed to the remote.\n\n` +
        `Verify your changes were pushed:\n` +
        `  git log origin/${branchName}..HEAD\n` +
        `  # Should show no commits (meaning everything is pushed)\n\n` +
        `If unpushed commits exist, push them:\n` +
        `  git push --force-with-lease origin ${branchName}\n\n` +
        `Wait a few seconds for GitHub to update, then verify the PR:\n` +
        `  gh pr view ${issueId}\n` +
        `  # Should show "Mergeable" status\n\n` +
        `Once the PR shows as mergeable on GitHub, call work_finish again.`,
      );
    }

    if (isConflictCycle) {
      validationSummary.lookupOutcome = "conflict_cycle_verified";
      validationSummary.detectedBranch = prStatus.sourceBranch ?? null;
      validationSummary.detectedBranchSource = prStatus.sourceBranch ? "pr_source_branch" : null;
      validationSummary.detectedBranchDecisionSummary = prStatus.sourceBranch
        ? `detected branch ${prStatus.sourceBranch} came from the linked PR source branch`
        : null;
      validationSummary.detectedBranchMismatchReasons = null;
      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_conflict_verified", {
        project: projectSlug,
        issueId,
        ...context,
        prUrl: prStatus.url ?? null,
        prSourceBranch: prStatus.sourceBranch ?? null,
        prMergeable: prStatus.mergeable ?? null,
        prLookupTargeting,
        prLookupTargetingDecision,
        repoSnapshot,
        pluginSourceRoot,
        pluginSnapshot,
        branchResolution,
      }).catch(() => {});
      await auditLog(workspaceDir, "conflict_resolution_verified", {
        project: projectSlug,
        issue: issueId,
        prUrl: prStatus.url,
        mergeable: prStatus.mergeable,
      });
    }

    return validationSummary;
  } catch (err) {
    // Re-throw our own validation errors; swallow provider/network errors.
    // Swallowing keeps work_finish unblocked when the API is unreachable.
    if (err instanceof Error && (err.message.startsWith("Cannot mark work_finish(done)") || err.message.startsWith("Cannot complete work_finish(done)"))) {
      throw err;
    }
    await recordWorkFinishDiagnostic(workspaceDir, "work_finish_pr_validation_warning", {
      project: projectSlug,
      issueId,
      ...context,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    console.warn(`PR validation warning for issue #${issueId}:`, err);
    return {
      lookupOutcome: "validation_warning",
      prUrl: null,
      prState: null,
      prSourceBranch: null,
      prMergeable: null,
      isConflictCycle: null,
      detectedBranch: null,
      detectedBranchSource: null,
      detectedBranchDecisionSummary: null,
      detectedBranchMismatchReasons: null,
      branchResolution: {},
      branchResolutionDecision: err instanceof Error ? err.message : String(err),
      branchWinnerDecisionSummary: null,
      branchSelectionWinnerSummary: null,
      branchWinnerComparedToLaneSummary: null,
    };
  }
}

export function createWorkFinishTool(ctx: PluginContext) {
  return (toolCtx: ToolContext) => ({
    name: "work_finish",
    label: "Work Finish",
    description: `Complete a task: Developer done (PR created, goes to review) or blocked. Tester pass/fail/refine/blocked. Reviewer approve/reject/blocked. Architect done/blocked. Handles label transition, state update, issue close/reopen, notifications, and audit logging.`,
    parameters: {
      type: "object",
      required: ["channelId", "role", "result"],
      properties: {
        channelId: { type: "string", description: "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from." },
        role: { type: "string", enum: getAllRoleIds(), description: "Worker role" },
        result: { type: "string", enum: ["done", "pass", "fail", "refine", "blocked", "approve", "reject"], description: "Completion result" },
        summary: { type: "string", description: "Brief summary" },
        prUrl: { type: "string", description: "PR/MR URL (auto-detected if omitted)" },
        createdTasks: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title", "url"],
            properties: {
              id: { type: "number", description: "Issue ID" },
              title: { type: "string", description: "Issue title" },
              url: { type: "string", description: "Issue URL" },
            },
          },
          description: "Tasks created during this work session (architect creates implementation tasks).",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const role = params.role as string;
      const result = params.result as string;
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const summary = params.summary as string | undefined;
      const prUrl = params.prUrl as string | undefined;
      const createdTasks = params.createdTasks as Array<{ id: number; title: string; url: string }> | undefined;
      const workspaceDir = requireWorkspaceDir(toolCtx);

      // Validate role:result using registry
      if (!isValidResult(role, result)) {
        const valid = getCompletionResults(role);
        throw new Error(`${role.toUpperCase()} cannot complete with "${result}". Valid results: ${valid.join(", ")}`);
      }

      // Resolve project + worker
      const { project } = await resolveProject(workspaceDir, channelId);
      const roleWorker = getRoleWorker(project, role);

      // Find the first active slot across all levels
      let slotIndex: number | null = null;
      let slotLevel: string | null = null;
      let issueId: number | null = null;

      for (const [level, slots] of Object.entries(roleWorker.levels)) {
        for (let i = 0; i < slots.length; i++) {
          if (slots[i]!.active && slots[i]!.issueId &&
              (!toolCtx.sessionKey || !slots[i]!.sessionKey ||
               slots[i]!.sessionKey === toolCtx.sessionKey)) {
            slotLevel = level;
            slotIndex = i;
            issueId = Number(slots[i]!.issueId);
            break;
          }
        }
        if (issueId !== null) break;
      }

      if (slotIndex === null || slotLevel === null || issueId === null) {
        throw new Error(`${role.toUpperCase()} worker not active on ${project.name}`);
      }

      const { provider } = await resolveProvider(project, ctx.runCommand);
      const workflow = await loadWorkflow(workspaceDir, project.name);

      if (!getRule(role, result, workflow))
        throw new Error(`Invalid completion: ${role}:${result}`);

      const repoPath = resolveRepoPath(project.repo);
      const pluginConfig = ctx.pluginConfig;
      const pluginSourceRoot = getPluginSourceRoot();
      const pluginSourceDerivation = getPluginSourceDerivation();
      const repoSnapshot = await getGitSnapshot(repoPath, ctx.runCommand);
      const pluginSnapshot = await getGitSnapshot(pluginSourceRoot, ctx.runCommand);
      const initialBranchResolution = buildBranchResolutionDiagnostic({
        repoPath,
        pluginSourceRoot,
        repoSnapshot,
        pluginSnapshot,
        prSourceBranch: null,
      });
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
      const configuredProviderTargetRepo = project.repoRemote ? normalizeRepoTarget(project.repoRemote) ?? null : null;
      const context = {
        channelId,
        role,
        result,
        slotLevel,
        slotIndex,
        configuredRepoPath: repoPath,
        configuredProviderTargetRepo,
        pluginSourceRoot,
        pluginSourceDerivation,
        loopDiagnosticsFlag: process.env.DEVCLAW_LOOP_DIAGNOSTICS ?? null,
        openclawConfigPluginLoadPaths,
        openclawConfigPluginLoadPathRealPaths,
        openclawConfigInstallSourcePath,
        openclawConfigInstallSourceRealPath,
        openclawConfigInstallPath,
        openclawConfigInstallPathRealPath,
        duplicateSourceRisk: pluginSourceConfigSummary.duplicateSourceRisk,
        pluginSourceConfigSummary,
        repoSnapshot,
        pluginSnapshot,
        branchResolution: initialBranchResolution,
      };

      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_execute_start", {
        project: project.slug,
        issueId,
        ...context,
        branchResolutionDecision:
          initialBranchResolution.repoAndPluginSameWorkTree === true
            ? initialBranchResolution.repoAndPluginSameBranch === true
              ? "repo path and live plugin agree on both worktree and branch before PR lookup"
              : "repo path and live plugin agree on worktree but disagree on current branch before PR lookup"
            : "repo path and live plugin disagree on worktree before PR lookup",
        branchResolutionPreferredSource: initialBranchResolution.preferredBranchSource,
        branchResolutionPreferredEvidence: initialBranchResolution.preferredBranchEvidence,
        branchResolutionMismatchFlags: {
          repoPathMatchesResolvedWorkTree: initialBranchResolution.repoPathMatchesResolvedWorkTree,
          repoRealPathMatchesResolvedWorkTree: initialBranchResolution.repoRealPathMatchesResolvedWorkTree,
          pluginSourceMatchesResolvedWorkTree: initialBranchResolution.pluginSourceMatchesResolvedWorkTree,
          pluginRealPathMatchesSourceRoot: initialBranchResolution.pluginRealPathMatchesSourceRoot,
          repoAndPluginSameWorkTree: initialBranchResolution.repoAndPluginSameWorkTree,
          repoAndPluginSameRealPath: initialBranchResolution.repoAndPluginSameRealPath,
          repoAndPluginSameBranch: initialBranchResolution.repoAndPluginSameBranch,
        },
        duplicateSourceDecision:
          context.duplicateSourceRisk
            ? "plugin config points at more than one distinct realpath, so install evidence is ambiguous until duplicate source is cleared"
            : "plugin config realpaths are singular or unresolved, so duplicate source risk is not evident from config alone",
        duplicateSourceCompetingRealPaths: pluginSourceConfigSummary.conflictingDevclawRealPaths,
        duplicateSourceDistinctRealPathCount: pluginSourceConfigSummary.distinctDevclawRealPathCount,
        duplicateSourceWinningRealPathGuess: pluginSourceConfigSummary.likelyWinningLiveRealPath,
        liveSourceDecision:
          openclawConfigInstallSourceRealPath && typeof pluginSnapshot.realRepoPath === "string"
            ? openclawConfigInstallSourceRealPath === pluginSnapshot.realRepoPath
              ? "observed live plugin realpath matches configured install source realpath"
              : "observed live plugin realpath differs from configured install source realpath"
            : "live-source comparison could not be completed because one of the realpaths was unavailable",
        liveSourceAgreementMatrix: {
          installSourceMatchesInstalledPath: pluginSourceConfigSummary.installSourceMatchesInstalledPath,
          installSourceMatchesLivePlugin: pluginSourceConfigSummary.installSourceMatchesLivePlugin,
          installedPathMatchesLivePlugin: pluginSourceConfigSummary.installedPathMatchesLivePlugin,
          pluginLoadPathsContainLivePlugin: pluginSourceConfigSummary.pluginLoadPathsContainLivePlugin,
          pluginLoadPathsContainInstallSource: pluginSourceConfigSummary.pluginLoadPathsContainInstallSource,
        },
        branchSelectionDecision:
          initialBranchResolution.preferredBranchSource === "configured_repo_branch"
            ? "configured repo branch would be trusted first if it matches PR source branch"
            : initialBranchResolution.preferredBranchSource === "configured_repo_head_branches"
              ? "configured repo detached-HEAD candidates would be trusted before live plugin branch"
              : initialBranchResolution.preferredBranchSource === "live_plugin_branch"
                ? "live plugin branch currently looks more trustworthy than configured repo branch for PR matching"
                : initialBranchResolution.preferredBranchSource === "live_plugin_head_branches"
                  ? "live plugin detached-HEAD candidates currently look more trustworthy than configured repo branch for PR matching"
                  : "no PR-aware branch match exists yet, so fallback branch selection would be ambiguous",
        branchSelectionDecisionTrace: {
          preferredBranchSource: initialBranchResolution.preferredBranchSource,
          preferredBranchConfidence: initialBranchResolution.preferredBranchConfidence,
          branchWinner: initialBranchResolution.branchWinner,
          branchWinnerSourceKind: initialBranchResolution.branchWinnerSourceKind,
          preferredBranchUsedFallback: initialBranchResolution.preferredBranchUsedFallback,
          repoBranchMatchesPrSourceBranch: initialBranchResolution.repoBranchMatchesPrSourceBranch,
          pluginBranchMatchesPrSourceBranch: initialBranchResolution.pluginBranchMatchesPrSourceBranch,
          repoHeadPointsAtPrSourceBranch: initialBranchResolution.repoHeadPointsAtPrSourceBranch,
          pluginHeadPointsAtPrSourceBranch: initialBranchResolution.pluginHeadPointsAtPrSourceBranch,
        },
        branchSelectionWinnerSummary: initialBranchResolution.branchSelectionWinnerSummary,
        branchWinnerDecisionSummary: initialBranchResolution.branchWinnerDecisionSummary,
        branchSelectionCandidateSnapshot: initialBranchResolution.branchSourceCandidatesInPriorityOrder,
        branchSelectionCandidateDecisionTable: initialBranchResolution.branchSourceCandidateDiagnostics,
        laneIdentitySummary: {
          configuredRepoPathBasename: typeof repoPath === "string" ? repoPath.split("/").filter(Boolean).at(-1) ?? null : null,
          pluginSourceRootBasename: pluginSourceRoot.split("/").filter(Boolean).at(-1) ?? null,
          configuredRepoBranch: initialBranchResolution.repoBranch,
          livePluginBranch: initialBranchResolution.pluginBranch,
          configuredRepoWorkTree: initialBranchResolution.repoWorkTree,
          livePluginWorkTree: initialBranchResolution.pluginWorkTree,
        },
        laneMismatchDecision:
          initialBranchResolution.repoAndPluginSameRealPath === true
            ? initialBranchResolution.repoAndPluginSameBranch === true
              ? "configured repo path and live plugin appear to be the same lane"
              : "configured repo path and live plugin share a realpath but report different branches, so branch inference may be stale or detached"
            : "configured repo path and live plugin resolve to different realpaths, so active lane versus detected branch may be mismatched",
        laneMismatchCategory:
          initialBranchResolution.repoAndPluginSameRealPath === true
            ? initialBranchResolution.repoAndPluginSameBranch === true
              ? "same_realpath_same_branch"
              : "same_realpath_branch_mismatch"
            : "different_realpaths",
        laneMismatchSummary: initialBranchResolution.branchMismatchSummary,
      }).catch(() => {});

      let prValidationSummary: WorkFinishPrValidationSummary | null = null;
      try {
        // For developers marking work as done, validate that a PR exists
        if (role === "developer" && result === "done") {
          prValidationSummary = await validatePrExistsForDeveloper(issueId, repoPath, provider, ctx.runCommand, workspaceDir, project.slug, configuredProviderTargetRepo, context);
        }

        const completion = await executeCompletion({
          workspaceDir, projectSlug: project.slug, role, result, issueId, summary, prUrl, provider, repoPath,
          projectName: project.name,
          channels: project.channels,
          pluginConfig,
          level: slotLevel,
          slotIndex,
          runtime: ctx.runtime,
          workflow,
          createdTasks,
          prValidationSummary,
          runCommand: ctx.runCommand,
        });

        await auditLog(workspaceDir, "work_finish", {
          project: project.name, issue: issueId, role, result,
          summary: summary ?? null, labelTransition: completion.labelTransition,
        });

        return jsonResult({
          success: true, project: project.name, projectSlug: project.slug, issueId, role, result,
          ...completion,
        });
      } catch (err) {
        await recordWorkFinishDiagnostic(workspaceDir, "work_finish_execute_error", {
          project: project.slug,
          issueId,
          ...context,
          summary: summary ?? null,
          prUrl: prUrl ?? null,
          createdTaskIds: createdTasks?.map((task) => task.id) ?? [],
          prValidationSummary,
          prValidationLookupOutcome: prValidationSummary?.lookupOutcome ?? null,
          prValidationBranchResolutionDecision: prValidationSummary?.branchResolutionDecision ?? null,
          prValidationBranchWinnerDecisionSummary: prValidationSummary?.branchWinnerDecisionSummary ?? null,
          prValidationBranchWinnerComparedToLaneSummary: prValidationSummary?.branchWinnerComparedToLaneSummary ?? null,
          error: (err as Error).message ?? String(err),
          errorName: err instanceof Error ? err.name : null,
          decisionPath: role === "developer" && result === "done"
            ? "work_finish failed during developer done handling, after start-time branch/worktree/plugin-source diagnostics were recorded"
            : "work_finish failed after start-time branch/worktree/plugin-source diagnostics were recorded",
        }).catch(() => {});
        throw err;
      }
    },
  });
}
