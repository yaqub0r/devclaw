/**
 * work_finish — Complete a task (DEV done, QA pass/fail/refine/blocked, architect done/blocked).
 *
 * Delegates side-effects to pipeline service: label transition, state update,
 * issue close/reopen, notifications, and audit logging.
 *
 * All roles (including architect) use the standard pipeline via executeCompletion.
 * Architect workflow: Researching → Done (done, closes issue), Researching → Refining (blocked).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext } from "../../types.js";
import type { PluginContext, RunCommand } from "../../context.js";
import { getRoleWorker, resolveRepoPath, findSlotByIssue } from "../../projects/index.js";
import { executeCompletion, getRule } from "../../services/pipeline.js";
import { log as auditLog } from "../../audit.js";
import { DATA_DIR } from "../../setup/migrate-layout.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";
import { getAllRoleIds, isValidResult, getCompletionResults } from "../../roles/index.js";
import { loadWorkflow } from "../../workflow/index.js";
import { GitHubProvider } from "../../providers/github.js";
import { PrState, type PrStatus } from "../../providers/provider.js";

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
async function getGitHubPrStatusFromUrl(
  prUrl: string,
  repoPath: string,
  runCommand: RunCommand,
): Promise<PrStatus | null> {
  try {
    const result = await runCommand([
      "gh", "pr", "view", prUrl,
      "--json", "url,title,state,headRefName,reviewDecision,mergeable",
    ], { timeoutMs: 10_000, cwd: repoPath });
    const pr = JSON.parse(result.stdout) as {
      url: string;
      title: string;
      state: string;
      headRefName?: string;
      reviewDecision?: string | null;
      mergeable?: string | null;
    };
    return {
      state: pr.state === "MERGED"
        ? PrState.MERGED
        : pr.reviewDecision === "APPROVED"
          ? PrState.APPROVED
          : pr.reviewDecision === "CHANGES_REQUESTED"
            ? PrState.CHANGES_REQUESTED
            : PrState.OPEN,
      url: pr.url,
      title: pr.title,
      sourceBranch: pr.headRefName,
      mergeable: pr.mergeable === "CONFLICTING" ? false : pr.mergeable === "MERGEABLE" ? true : undefined,
    };
  } catch {
    return null;
  }
}

async function getGitHubPrStatusFromBranch(
  branchName: string,
  repoPath: string,
  runCommand: RunCommand,
): Promise<PrStatus | null> {
  try {
    const result = await runCommand([
      "gh", "pr", "list",
      "--head", branchName,
      "--state", "all",
      "--limit", "1",
      "--json", "url,title,state,headRefName,reviewDecision,mergeable",
    ], { timeoutMs: 10_000, cwd: repoPath });
    const prs = JSON.parse(result.stdout) as Array<{
      url: string;
      title: string;
      state: string;
      headRefName?: string;
      reviewDecision?: string | null;
      mergeable?: string | null;
    }>;
    const pr = prs[0];
    if (!pr?.url) return null;
    return {
      state: pr.state === "MERGED"
        ? PrState.MERGED
        : pr.reviewDecision === "APPROVED"
          ? PrState.APPROVED
          : pr.reviewDecision === "CHANGES_REQUESTED"
            ? PrState.CHANGES_REQUESTED
            : PrState.OPEN,
      url: pr.url,
      title: pr.title,
      sourceBranch: pr.headRefName,
      mergeable: pr.mergeable === "CONFLICTING" ? false : pr.mergeable === "MERGEABLE" ? true : undefined,
    };
  } catch {
    return null;
  }
}

async function resolveDeveloperPrStatus(
  issueId: number,
  repoPath: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>["provider"],
  runCommand: RunCommand,
  explicitPrUrl?: string,
): Promise<{ prStatus: PrStatus; branchName: string; source: "explicit" | "branch" | "issue" }> {
  let branchName = "current-branch";
  try {
    branchName = await getCurrentBranch(repoPath, runCommand);
  } catch {
    // Fall back to generic placeholder
  }

  let issuePrStatus: PrStatus | null = null;
  const getIssuePrStatus = async (): Promise<PrStatus> => {
    if (issuePrStatus) return issuePrStatus;
    issuePrStatus = await provider.getPrStatus(issueId);
    return issuePrStatus;
  };

  if (explicitPrUrl) {
    if (provider instanceof GitHubProvider) {
      const byUrl = await getGitHubPrStatusFromUrl(explicitPrUrl, repoPath, runCommand);
      if (byUrl?.url) return { prStatus: byUrl, branchName: byUrl.sourceBranch || branchName, source: "explicit" };
    }

    const byIssue = await getIssuePrStatus();
    if (byIssue.url === explicitPrUrl) {
      return { prStatus: byIssue, branchName: byIssue.sourceBranch || branchName, source: "explicit" };
    }

    return {
      prStatus: { state: PrState.CLOSED, url: null },
      branchName,
      source: "explicit",
    };
  }

  if (branchName && provider instanceof GitHubProvider) {
    const byBranch = await getGitHubPrStatusFromBranch(branchName, repoPath, runCommand);
    if (byBranch?.url) return { prStatus: byBranch, branchName, source: "branch" };
  }

  if (branchName) {
    const byIssue = await getIssuePrStatus();
    if (byIssue.url && byIssue.sourceBranch === branchName) {
      return { prStatus: byIssue, branchName, source: "branch" };
    }
  }

  const prStatus = await getIssuePrStatus();
  return { prStatus, branchName: prStatus.sourceBranch || branchName, source: "issue" };
}

export async function validatePrExistsForDeveloper(
  issueId: number,
  repoPath: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>["provider"],
  runCommand: RunCommand,
  workspaceDir: string,
  projectSlug: string,
  explicitPrUrl?: string,
): Promise<void> {
  try {
    const { prStatus, branchName, source } = await resolveDeveloperPrStatus(
      issueId,
      repoPath,
      provider,
      runCommand,
      explicitPrUrl,
    );

    if (prStatus.ambiguous) {
      throw new Error(
        `Cannot mark work_finish(done) while multiple PRs are linked to this issue.\n\n` +
        `✗ Ambiguity: ${prStatus.reason ?? "multiple candidate PRs"}\n` +
        `${(prStatus.candidates ?? []).map((pr) => `  - ${pr.state}: ${pr.url}`).join("\n")}\n\n` +
        `Please explicitly close or supersede the extra PRs so one canonical PR remains, then call work_finish again.`,
      );
    }

    if (!prStatus.url) {
      throw new Error(
        `Cannot mark work_finish(done) without an open PR.\n\n` +
        `✗ No PR found for branch: ${branchName}\n\n` +
        `Please create a PR first:\n` +
        `  gh pr create --base main --head ${branchName} --title "..." --body "..."\n\n` +
        `Then call work_finish again.`,
      );
    }

    if (source !== "issue") {
      await auditLog(workspaceDir, "work_finish_pr_override", {
        project: projectSlug,
        issue: issueId,
        prUrl: prStatus.url,
        reason: source === "explicit" ? "explicit_pr_url_used" : "branch_pr_used",
      });
    }

    try {
      const hasEyes = await provider.prHasReaction(issueId, "eyes");
      if (!hasEyes) {
        await provider.reactToPr(issueId, "eyes");
      }
    } catch {
      // Ignore errors — marking is cosmetic
    }

    const isConflictCycle = await isConflictResolutionCycle(workspaceDir, issueId);

    if (isConflictCycle && prStatus.mergeable === false) {
      await auditLog(workspaceDir, "work_finish_rejected", {
        project: projectSlug,
        issue: issueId,
        reason: "pr_still_conflicting",
        prUrl: prStatus.url,
      });

      const prBranchName = prStatus.sourceBranch || branchName || "your-branch";
      throw new Error(
        `Cannot complete work_finish(done) while PR still shows merge conflicts.\n\n` +
        `✗ PR status: CONFLICTING\n` +
        `✗ PR URL: ${prStatus.url}\n` +
        `✗ Branch: ${prBranchName}\n\n` +
        `Your local rebase may have succeeded, but changes must be pushed to the remote.\n\n` +
        `Verify your changes were pushed:\n` +
        `  git log origin/${prBranchName}..HEAD\n` +
        `  # Should show no commits (meaning everything is pushed)\n\n` +
        `If unpushed commits exist, push them:\n` +
        `  git push --force-with-lease origin ${prBranchName}\n\n` +
        `Wait a few seconds for GitHub to update, then verify the PR:\n` +
        `  gh pr view ${prStatus.url}\n` +
        `  # Should show "Mergeable" status\n\n` +
        `Once the PR shows as mergeable on GitHub, call work_finish again.`,
      );
    }

    if (isConflictCycle) {
      await auditLog(workspaceDir, "conflict_resolution_verified", {
        project: projectSlug,
        issue: issueId,
        prUrl: prStatus.url,
        mergeable: prStatus.mergeable,
      });
    }
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Cannot mark work_finish(done)") || err.message.startsWith("Cannot complete work_finish(done)"))) {
      throw err;
    }
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

      // For developers marking work as done, validate that a PR exists
      if (role === "developer" && result === "done") {
        await validatePrExistsForDeveloper(issueId, repoPath, provider, ctx.runCommand, workspaceDir, project.slug, prUrl);
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

      return ({
        success: true, project: project.name, projectSlug: project.slug, issueId, role, result,
        ...completion,
      });
    },
  });
}
