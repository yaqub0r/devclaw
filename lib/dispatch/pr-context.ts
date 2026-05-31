/**
 * pr-context.ts — PR context fetching for dispatch.
 *
 * Extracts PR-related data gathering from the dispatch flow.
 * Two use cases:
 *   1. PR feedback for re-dispatch (issue returning from review with changes requested)
 *   2. PR context for reviewer role (URL + diff for code review)
 */
import type { IssueProvider } from "../providers/provider.js";
import { PrState } from "../providers/provider.js";
import { resolveCanonicalPrForIssue } from "../services/canonical-pr.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PrFeedback = {
  url: string;
  /** Source branch name (e.g. "feature/484-explicit-branch-name"). */
  branchName?: string;
  reason?: "changes_requested" | "merge_conflict" | "rejected";
  comments: Array<{ id: number; author: string; body: string; state: string; path?: string; line?: number }>;
};

export type PrContext =
  | {
    url: string;
    diff: string;
    canonical: true;
  }
  | {
    url: string;
    diff?: string;
    canonical: false;
  };

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch PR review feedback for an issue returning from review.
 * Returns undefined if no PR found, or if the PR is not currently in a
 * feedback-worthy state.
 * Canonical routing errors are allowed to bubble so dispatch fails closed.
 *
 * Includes explicit branch name in feedback to prevent developers from working
 * on the wrong PR when multiple PRs exist for the same issue (#482).
 */
export async function fetchPrFeedback(
  provider: IssueProvider,
  issueId: number,
  opts?: { workspaceDir?: string; projectSlug?: string },
): Promise<PrFeedback | undefined> {
  let canonicalUrl: string | undefined;
  if (opts?.workspaceDir && opts?.projectSlug) {
    canonicalUrl = (await resolveCanonicalPrForIssue({ workspaceDir: opts.workspaceDir, projectSlug: opts.projectSlug, issueId, provider, allowBackfill: false })).url;
  }

  const prStatus = canonicalUrl
    ? await provider.getPrStatusByUrl(canonicalUrl)
    : await provider.getPrStatus(issueId);
  if (canonicalUrl && !prStatus) {
    throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: stored PR ${canonicalUrl} no longer resolves.`);
  }
  if (!prStatus?.url || prStatus.state === PrState.MERGED || prStatus.state === PrState.CLOSED) {
    return undefined;
  }

  const reason = prStatus.mergeable === false ? "merge_conflict" as const
    : (prStatus.state === PrState.CHANGES_REQUESTED || prStatus.state === PrState.HAS_COMMENTS) ? "changes_requested" as const
    : undefined;
  if (!reason) return undefined;

  const reviewComments = opts?.workspaceDir && opts?.projectSlug
    ? await provider.getPrReviewCommentsByUrl(prStatus.url)
    : await provider.getPrReviewComments(issueId);

  return {
    url: prStatus.url,
    branchName: prStatus.sourceBranch,
    reason,
    comments: reviewComments.map((c) => ({
      id: c.id, author: c.author, body: c.body, state: c.state,
      path: c.path, line: c.line,
    })),
  };
}

/**
 * Fetch PR context (URL + diff) for code review.
 * Returns undefined if no PR found.
 * Canonical routing errors are allowed to bubble so dispatch fails closed.
 */
export async function fetchPrContext(
  provider: IssueProvider,
  issueId: number,
  opts?: { workspaceDir?: string; projectSlug?: string },
): Promise<PrContext | undefined> {
  const canonicalRouting = !!(opts?.workspaceDir && opts?.projectSlug);
  const canonicalUrl = canonicalRouting
    ? (await resolveCanonicalPrForIssue({ workspaceDir: opts.workspaceDir!, projectSlug: opts.projectSlug!, issueId, provider, allowBackfill: false })).url
    : undefined;
  const prStatus = canonicalUrl
    ? await provider.getPrStatusByUrl(canonicalUrl)
    : await provider.getPrStatus(issueId);
  if (canonicalUrl && !prStatus) {
    throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: stored PR ${canonicalUrl} no longer resolves.`);
  }
  if (!prStatus?.url) return undefined;

  const diff = canonicalRouting
    ? await provider.getPrDiffByUrl(prStatus.url)
    : await provider.getPrDiff(issueId);

  if (canonicalUrl && diff == null) {
    throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: stored PR ${canonicalUrl} has no URL-scoped diff context.`);
  }

  if (canonicalUrl) {
    return { url: prStatus.url, diff, canonical: true };
  }

  return { url: prStatus.url, diff: diff ?? undefined, canonical: false };
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Format PR context section for task message.
 */
export function formatPrContext(prContext: PrContext): string[] {
  const parts: string[] = [``, `## Pull Request`, `🔗 ${prContext.url}`];
  if (prContext.diff) {
    const maxDiffLen = 50_000;
    const diff = prContext.diff.length > maxDiffLen
      ? prContext.diff.slice(0, maxDiffLen) + "\n... (diff truncated, see PR for full changes)"
      : prContext.diff;
    parts.push(``, `### Diff`, "```diff", diff, "```");
  }
  return parts;
}

/**
 * Format PR review feedback section for task message.
 */
export function formatPrFeedback(prFeedback: PrFeedback, baseBranch: string): string[] {
  const reasonLabel = prFeedback.reason === "merge_conflict"
    ? "⚠️ Merge conflicts detected"
    : prFeedback.reason === "changes_requested"
      ? "⚠️ Changes were requested"
      : "⚠️ PR was rejected";

  const parts: string[] = [
    ``, `## PR Review Feedback`,
    `${reasonLabel}. Address the feedback below.`,
    `🔗 ${prFeedback.url}`,
  ];

  if (prFeedback.comments.length > 0) {
    for (const c of prFeedback.comments) {
      const location = c.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : "";
      parts.push(``, `**${c.author}** [${c.state}]${location}:`, c.body);
    }
  } else {
    parts.push(``, `_No review comment bodies were retrieved, but this canonical PR still needs attention._`);
  }

  if (prFeedback.reason === "merge_conflict") {
    const branchName = prFeedback.branchName || "your-branch";

    parts.push(
      ``, `### Conflict Resolution Instructions`,
      ``,
      `**Important:** You must update the EXISTING canonical PR branch, not create a new one.`,
      ``,
      `🔹 PR: ${prFeedback.url}`,
      `🔹 Branch: \`${branchName}\``,
      ``,
      `**Step-by-step:**`,
      ``,
      `1. Fetch and check out the PR branch:`,
      `   \`\`\`bash`,
      `   git fetch origin ${branchName}`,
      `   git checkout ${branchName}`,
      `   # Or if you already have a worktree:`,
      `   cd "${branchName}"`,
      `   git fetch origin`,
      `   git reset --hard origin/${branchName}`,
      `   \`\`\``,
      ``,
      `2. Rebase onto \`${baseBranch}\`:`,
      `   \`\`\`bash`,
      `   git rebase ${baseBranch}`,
      `   \`\`\``,
      ``,
      `3. Resolve any conflicts:`,
      `   - Edit conflicted files (marked with <<<<<<< and >>>>>>>)`,
      `   - \`git add <resolved-files>\``,
      `   - \`git rebase --continue\``,
      `   - Repeat until rebase completes`,
      ``,
      `4. Force-push to the SAME branch:`,
      `   \`\`\`bash`,
      `   git push --force-with-lease origin ${branchName}`,
      `   \`\`\``,
      ``,
      `5. Verify the PR shows as mergeable:`,
      `   \`\`\`bash`,
      `   gh pr view <PR-number>`,
      `   # Status should be "Mergeable" or "Open"`,
      `   \`\`\``,
      ``,
      `⚠️ Do NOT create a new PR unless the task explicitly calls for replacement. Do NOT switch branches. Update THIS canonical PR only.`,
    );
  }

  return parts;
}
