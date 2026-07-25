/**
 * message-builder.ts — Task message construction for worker sessions.
 */
import type { ResolvedRoleConfig } from "../config/index.js";
import { getFallbackEmoji } from "../roles/index.js";
import type { NotifyRoutingTarget } from "./session.js";
import {
  formatPrContext,
  formatPrFeedback,
  type PrContext,
  type PrFeedback,
} from "./pr-context.js";

function buildRoutingContext(target: NotifyRoutingTarget): string[] {
  return [
    "Project channel routing:",
    `- \`channel\`: "${target.channel}"`,
    `- \`channelId\`: "${target.channelId}"`,
    ...(target.accountId ? [`- \`accountId\`: "${target.accountId}"`] : []),
    ...(target.messageThreadId != null
      ? [`- \`messageThreadId\`: ${target.messageThreadId}`]
      : []),
  ];
}

function buildCompletionInstructions(
  role: string,
  results: string[],
  target: NotifyRoutingTarget,
): string[] {
  const completionArgs: Record<string, unknown> = {
    role,
    channelId: target.channelId,
    ...(target.messageThreadId != null
      ? { messageThreadId: target.messageThreadId }
      : {}),
    result: `<one of: ${results.join(", ")}>`,
    summary: "<brief description of what you did>",
  };

  return [
    "",
    "---",
    "",
    "## MANDATORY: Task Completion",
    "",
    "When you finish this task, you MUST call `work_finish` with this routing context:",
    "```json",
    JSON.stringify(completionArgs, null, 2),
    "```",
    "",
    `Valid \`result\` values: ${results.map((result) => `"${result}"`).join(", ")}`,
    "",
    "You MUST call work_finish even if you encounter errors or cannot finish.",
    'Use "blocked" with a summary explaining why you are stuck.',
    "Never end your session without calling work_finish.",
  ];
}

/**
 * Build the task message sent to a worker session.
 *
 * Role-specific instructions are NOT included in the message body.
 * They are passed as `extraSystemPrompt` in the gateway agent call.
 */
export function buildTaskMessage(opts: {
  projectName: string;
  routing: NotifyRoutingTarget;
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
  /** Pre-formatted attachment context string (from formatAttachmentsForTask). */
  attachmentContext?: string;
}): string {
  const {
    projectName,
    routing,
    role,
    issueId,
    issueTitle,
    issueDescription,
    issueUrl,
    repo,
    baseBranch,
  } = opts;

  const results = opts.resolvedRole?.completionResults ?? [];
  const parts = [
    `${role.toUpperCase()} task for project "${projectName}" — Issue #${issueId}`,
    "",
    issueTitle,
    issueDescription ? `\n${issueDescription}` : "",
  ];

  if (opts.prFeedback) {
    parts.push(
      "",
      "> **⚠️ FEEDBACK CYCLE — This issue is returning from review.**",
      "> The original description above is for context only.",
      "> Your job is to address the PR Review Feedback and Comments below.",
      "> When feedback conflicts with the original description, follow the feedback.",
    );
  }

  if (opts.comments && opts.comments.length > 0) {
    parts.push("", "## Comments");
    for (const comment of opts.comments.slice(-20)) {
      const date = new Date(comment.created_at).toLocaleString();
      parts.push("", `**${comment.author}** (${date}):`, comment.body);
    }
  }

  if (opts.prContext) parts.push(...formatPrContext(opts.prContext));
  if (opts.prFeedback) {
    parts.push(...formatPrFeedback(opts.prFeedback, baseBranch));
    if (!opts.prFeedback.branchName && opts.prFeedback.reason === "merge_conflict") {
      parts.push(
        "",
        "⚠️ **Branch name could not be determined automatically.**",
        "Check the PR URL above to find the correct branch, then:",
        "```bash",
        "gh pr view <PR-number> --json headRefName --jq .headRefName",
        "```",
      );
    }
  }
  if (opts.attachmentContext) parts.push(opts.attachmentContext);

  parts.push(
    "",
    `Repo: ${repo} | Branch: ${baseBranch} | ${issueUrl}`,
    `Project: ${projectName}`,
    ...buildRoutingContext(routing),
    ...buildCompletionInstructions(role, results, routing),
  );

  return parts.join("\n");
}

/**
 * Build a minimal conflict-fix message: no issue description or comments.
 */
export function buildConflictFixMessage(opts: {
  projectName: string;
  routing: NotifyRoutingTarget;
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
    projectName,
    routing,
    role,
    issueId,
    issueUrl,
    repo,
    baseBranch,
    prFeedback,
  } = opts;
  const results = opts.resolvedRole?.completionResults ?? [];

  const parts = [
    `${role.toUpperCase()} task for project "${projectName}" — Issue #${issueId}`,
    "",
    "> **🔧 MERGE CONFLICT FIX — This is a focused conflict resolution task.**",
    `> Rebase the PR branch onto \`${baseBranch}\`, resolve conflicts, and force-push.`,
    "> Do NOT re-implement the feature or make other changes.",
    ...formatPrFeedback(prFeedback, baseBranch),
    "",
    `Repo: ${repo} | Branch: ${baseBranch} | ${issueUrl}`,
    `Project: ${projectName}`,
    ...buildRoutingContext(routing),
    ...buildCompletionInstructions(role, results, routing),
  ];

  return parts.join("\n");
}

export function buildAnnouncement(
  level: string,
  role: string,
  sessionAction: "spawn" | "send",
  issueId: number,
  issueTitle: string,
  issueUrl: string,
  resolvedRole?: ResolvedRoleConfig,
  botName?: string,
): string {
  const emoji = resolvedRole?.emoji[level] ?? getFallbackEmoji(role);
  const actionVerb = sessionAction === "spawn" ? "Spawning" : "Sending";
  const nameTag = botName ? ` ${botName}` : "";
  return `${emoji} ${actionVerb} ${role.toUpperCase()}${nameTag} (${level}) for #${issueId}: ${issueTitle}\n🔗 [Issue #${issueId}](${issueUrl})`;
}

/**
 * Build a human-friendly session label from project name, role, and level.
 */
export function formatSessionLabel(
  projectName: string,
  role: string,
  level: string,
  botName?: string,
): string {
  const titleCase = (value: string) =>
    value.replace(/(^|\s|-)\S/g, (character) => character.toUpperCase()).replace(/-/g, " ");
  const nameLabel = botName ? ` ${botName}` : "";
  return `${titleCase(projectName)} — ${titleCase(role)}${nameLabel} (${titleCase(level)})`;
}
