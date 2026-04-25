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
import { jsonResult, requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";
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

  return {
    repoBranch,
    repoWorkTree,
    repoRealPath,
    repoHeadBranches,
    pluginBranch,
    pluginWorkTree,
    pluginRealPath,
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
    preferredBranchSource:
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
                  : "no_branch_match",
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
  context: Record<string, unknown> = {},
): Promise<void> {
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

      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_pr_missing", {
        project: projectSlug,
        issueId,
        ...context,
        repoSnapshot,
        pluginSourceRoot,
        pluginSnapshot,
        detectedBranch: branchName,
        branchResolution: buildBranchResolutionDiagnostic({
          repoPath,
          pluginSourceRoot,
          repoSnapshot,
          pluginSnapshot,
          prSourceBranch: null,
        }),
      }).catch(() => {});

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

    await recordWorkFinishDiagnostic(workspaceDir, "work_finish_conflict_cycle_check", {
      project: projectSlug,
      issueId,
      ...context,
      isConflictCycle,
      prUrl: prStatus.url ?? null,
      prSourceBranch: prStatus.sourceBranch ?? null,
      prMergeable: prStatus.mergeable ?? null,
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
      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_conflict_rejected", {
        project: projectSlug,
        issueId,
        ...context,
        prUrl: prStatus.url ?? null,
        prSourceBranch: prStatus.sourceBranch ?? null,
        detectedBranch: branchName,
        prMergeable: prStatus.mergeable ?? null,
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
      await recordWorkFinishDiagnostic(workspaceDir, "work_finish_conflict_verified", {
        project: projectSlug,
        issueId,
        ...context,
        prUrl: prStatus.url ?? null,
        prSourceBranch: prStatus.sourceBranch ?? null,
        prMergeable: prStatus.mergeable ?? null,
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
      const repoSnapshot = await getGitSnapshot(repoPath, ctx.runCommand);
      const pluginSnapshot = await getGitSnapshot(pluginSourceRoot, ctx.runCommand);
      const initialBranchResolution = buildBranchResolutionDiagnostic({
        repoPath,
        pluginSourceRoot,
        repoSnapshot,
        pluginSnapshot,
        prSourceBranch: null,
      });
      const context = {
        channelId,
        role,
        result,
        slotLevel,
        slotIndex,
        configuredRepoPath: repoPath,
        pluginSourceRoot,
        loopDiagnosticsFlag: process.env.DEVCLAW_LOOP_DIAGNOSTICS ?? null,
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
      }).catch(() => {});

      // For developers marking work as done, validate that a PR exists
      if (role === "developer" && result === "done") {
        await validatePrExistsForDeveloper(issueId, repoPath, provider, ctx.runCommand, workspaceDir, project.slug, context);
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
    },
  });
}
