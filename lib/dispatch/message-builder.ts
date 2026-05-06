/**
 * message-builder.ts — Task message construction for worker sessions.
 */
import type { ResolvedRoleConfig } from "../config/index.js";
import { formatPrContext, formatPrFeedback, type PrContext, type PrFeedback } from "./pr-context.js";
import { getFallbackEmoji } from "../roles/index.js";

/**
 * Build the task message sent to a worker session.
 *
 * Role-specific instructions are NOT included in the message body.
 * They are passed as `extraSystemPrompt` in the gateway agent call,
 * which injects them into the worker's system prompt (see dispatch flow).
 */
export function buildTaskMessage(opts: {
  projectName: string;
  channelId: string;
  role: string;
  issueId: number;
  issueTitle: string;
  issueDescription: string;
  issueUrl: string;
  repo: string;
  baseBranch: string;
  comments?: Array<{ author: string; body: string; created_at: string }>;
  resolvedRole?: ResolvedRoleConfig;
  prContext?: PrContext;
  prFeedback?: PrFeedback;
  checkoutContract?: {
    targetRef?: string;
    targetSha?: string;
    targetBranch?: string;
    expectedWorktreePath?: string;
    requiredCleanTree?: boolean;
    requireIsolatedWorktree?: boolean;
    decisiveVerdictRequiresMatch?: boolean;
  };
  /** Pre-formatted attachment context string (from formatAttachmentsForTask) */
  attachmentContext?: string;
}): string {
  const {
    projectName, channelId, role, issueId, issueTitle,
    issueDescription, issueUrl, repo, baseBranch,
  } = opts;

  const results = opts.resolvedRole?.completionResults ?? [];
  const availableResults = results.map((r: string) => `"${r}"`).join(", ");

  const isFeedbackCycle = !!opts.prFeedback;

  const parts = [
    `${role.toUpperCase()} task for project "${projectName}" — Issue #${issueId}`,
    ``,
    issueTitle,
    issueDescription ? `\n${issueDescription}` : "",
  ];

  if (isFeedbackCycle) {
    parts.push(
      ``,
      `> **⚠️ FEEDBACK CYCLE — This issue is returning from review.**`,
      `> The original description above is for context only.`,
      `> Your job is to address the PR Review Feedback and Comments below.`,
      `> When feedback conflicts with the original description, follow the feedback.`,
    );
  }

  // Include comments if present
  if (opts.comments && opts.comments.length > 0) {
    parts.push(``, `## Comments`);
    // Limit to last 20 comments to avoid bloating context
    const recentComments = opts.comments.slice(-20);
    for (const comment of recentComments) {
      const date = new Date(comment.created_at).toLocaleString();
      parts.push(``, `**${comment.author}** (${date}):`, comment.body);
    }
  }

  if (opts.prContext) parts.push(...formatPrContext(opts.prContext));
  if (opts.prFeedback) {
    parts.push(...formatPrFeedback(opts.prFeedback, baseBranch));

    // Defensive warning if branch name is missing (shouldn't happen in practice)
    if (!opts.prFeedback.branchName && opts.prFeedback.reason === "merge_conflict") {
      parts.push(
        ``,
        `⚠️ **Branch name could not be determined automatically.**`,
        `Check the PR URL above to find the correct branch, then:`,
        `\`\`\`bash`,
        `gh pr view <PR-number> --json headRefName --jq .headRefName`,
        `\`\`\``,
      );
    }
  }

  if (opts.checkoutContract) {
    const c = opts.checkoutContract;
    parts.push(...[
      ``,
      `## Required Checkout Contract`,
      `Use an isolated worktree or other clean checkout for decisive validation. Do not trust a shared mutable workspace.`,
      c.targetBranch ? `- Target branch: \`${c.targetBranch}\`` : undefined,
      c.expectedWorktreePath ? `- Expected worktree path: \`${c.expectedWorktreePath}\`` : undefined,
      c.targetRef ? `- Target ref: \`${c.targetRef}\`` : `- Target ref: resolve from the linked PR/base branch before validating`,
      c.targetSha ? `- Target commit: \`${c.targetSha}\`` : `- Target commit: record the exact commit you validated`,
      `- Required clean tree: ${c.requiredCleanTree === false ? "recommended" : "yes"}`,
      `- Required isolated worktree: ${c.requireIsolatedWorktree === false ? "recommended" : "yes"}`,
      `- Definitive pass/fail or approve/reject only after HEAD matches the target commit and the tree is clean`,
      ``,
      `Before giving a decisive verdict, record this provenance in your task_comment or summary:`,
      `- repo path`,
      `- worktree path`,
      `- branch/ref`,
      `- \`git rev-parse HEAD\``,
      `- dirty/clean status from \`git status --short\``,
      c.targetSha ? `- confirmation that HEAD == \`${c.targetSha}\`` : `- the target commit you intended to validate`,
      ``,
      `If the expected branch or isolated worktree is missing, stop and report it as a checkout-contract failure instead of continuing in an ambient shared checkout.`,
      `Refuse a definitive verdict if the checkout is dirty or does not match the target commit. Use work_finish("blocked") if needed.`,
    ].filter(Boolean) as string[]);
  }

  if (opts.attachmentContext) parts.push(opts.attachmentContext);

  parts.push(
    ``,
    `Repo: ${repo} | Branch: ${baseBranch} | ${issueUrl}`,
    `Project: ${projectName} | Channel: ${channelId}`,
  );

  parts.push(
    ``, `---`, ``,
    `## MANDATORY: Task Completion`,
    ``,
    `When you finish this task, you MUST call \`work_finish\` with:`,
    `- \`role\`: "${role}"`,
    `- \`channelId\`: "${channelId}"`,
    `- \`result\`: ${availableResults}`,
    `- \`summary\`: brief description of what you did`,
    ``,
    `⚠️ You MUST call work_finish even if you encounter errors or cannot finish.`,
    `Use "blocked" with a summary explaining why you're stuck.`,
    `Never end your session without calling work_finish.`,
  );



  return parts.join("\n");
}

/**
 * Build a minimal conflict-fix message — no issue description, no comments.
 * Just the PR feedback (rebase instructions) and work_finish instructions.
 */
export function buildConflictFixMessage(opts: {
  projectName: string;
  channelId: string;
  role: string;
  issueId: number;
  issueTitle: string;
  issueUrl: string;
  repo: string;
  baseBranch: string;
  resolvedRole?: ResolvedRoleConfig;
  prFeedback: PrFeedback;
}): string {
  const {
    projectName, channelId, role, issueId, issueTitle,
    issueUrl, repo, baseBranch, prFeedback,
  } = opts;

  const results = opts.resolvedRole?.completionResults ?? [];
  const availableResults = results.map((r: string) => `"${r}"`).join(", ");

  const parts = [
    `${role.toUpperCase()} task for project "${projectName}" — Issue #${issueId}`,
    ``,
    `> **🔧 MERGE CONFLICT FIX — This is a focused conflict resolution task.**`,
    `> Rebase the PR branch onto \`${baseBranch}\`, resolve conflicts, and force-push.`,
    `> Do NOT re-implement the feature or make other changes.`,
  ];

  parts.push(...formatPrFeedback(prFeedback, baseBranch));

  parts.push(
    ``,
    `Repo: ${repo} | Branch: ${baseBranch} | ${issueUrl}`,
    `Project: ${projectName} | Channel: ${channelId}`,
  );

  parts.push(
    ``, `---`, ``,
    `## MANDATORY: Task Completion`,
    ``,
    `When you finish this task, you MUST call \`work_finish\` with:`,
    `- \`role\`: "${role}"`,
    `- \`channelId\`: "${channelId}"`,
    `- \`result\`: ${availableResults}`,
    `- \`summary\`: brief description of what you did`,
    ``,
    `⚠️ You MUST call work_finish even if you encounter errors or cannot finish.`,
    `Use "blocked" with a summary explaining why you're stuck.`,
    `Never end your session without calling work_finish.`,
  );

  return parts.join("\n");
}

export function buildAnnouncement(
  level: string, role: string, sessionAction: "spawn" | "send",
  issueId: number, issueTitle: string, issueUrl: string,
  resolvedRole?: ResolvedRoleConfig, botName?: string,
): string {
  const emoji = resolvedRole?.emoji[level] ?? getFallbackEmoji(role);
  const actionVerb = sessionAction === "spawn" ? "Spawning" : "Sending";
  const nameTag = botName ? ` ${botName}` : "";
  return `${emoji} ${actionVerb} ${role.toUpperCase()}${nameTag} (${level}) for #${issueId}: ${issueTitle}\n🔗 [Issue #${issueId}](${issueUrl})`;
}

/**
 * Build a human-friendly session label from project name, role, and level.
 * e.g. "my-project", "developer", "medior" → "My Project — Developer (Medior)"
 */
export function formatSessionLabel(projectName: string, role: string, level: string, botName?: string): string {
  const titleCase = (s: string) => s.replace(/(^|\s|-)\S/g, (c) => c.toUpperCase()).replace(/-/g, " ");
  const nameLabel = botName ? ` ${botName}` : "";
  return `${titleCase(projectName)} — ${titleCase(role)}${nameLabel} (${titleCase(level)})`;
}
