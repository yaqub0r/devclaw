/**
 * Canonical PR/workflow reconciliation.
 *
 * Computes one shared view of an issue's review state from workflow labels,
 * routing labels, and provider PR status. Callers should use this instead of
 * hand-rolling PR + label interpretation.
 */
import type { Issue, IssueProvider, PrStatus } from "../providers/provider.js";
import { PrState } from "../providers/provider.js";
import { detectStepRouting } from "./queue-scan.js";
import { getCurrentStateLabel, type WorkflowConfig } from "../workflow/index.js";

export type ReviewRouting = "human" | "agent" | "skip" | null;
export type CanonicalReviewState =
  | "not_in_review"
  | "awaiting_human_review"
  | "awaiting_agent_review"
  | "review_skipped"
  | "changes_requested"
  | "merge_conflict"
  | "pr_closed"
  | "merged"
  | "ambiguous";

export type CanonicalReviewStatus = {
  stateLabel: string | null;
  routing: ReviewRouting;
  inReviewQueue: boolean;
  needsHumanReview: boolean;
  needsAgentReview: boolean;
  shouldSkipReview: boolean;
  prStatus: PrStatus;
  canonicalState: CanonicalReviewState;
  ambiguous: boolean;
  reason?: string;
};

export async function getCanonicalReviewStatus(
  provider: IssueProvider,
  workflow: WorkflowConfig,
  issue: Issue,
): Promise<CanonicalReviewStatus> {
  const stateLabel = getCurrentStateLabel(issue.labels, workflow);
  const stateConfig = stateLabel
    ? Object.values(workflow.states).find((state) => state.label === stateLabel) ?? null
    : null;
  const inReviewQueue = Boolean(stateConfig?.check);
  const routing = detectStepRouting(issue.labels, "review") as ReviewRouting;
  const prStatus = await provider.getPrStatus(issue.iid);

  if (prStatus.ambiguous) {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "ambiguous",
      ambiguous: true,
      reason: prStatus.reason ?? "multiple_prs",
    };
  }

  if (prStatus.mergeable === false) {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "merge_conflict",
      ambiguous: false,
      reason: "merge_conflict",
    };
  }

  if (prStatus.state === PrState.CHANGES_REQUESTED || prStatus.state === PrState.HAS_COMMENTS) {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "changes_requested",
      ambiguous: false,
      reason: prStatus.state,
    };
  }

  if (prStatus.state === PrState.CLOSED && prStatus.url) {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "pr_closed",
      ambiguous: false,
      reason: "pr_closed",
    };
  }

  if (prStatus.state === PrState.MERGED) {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "merged",
      ambiguous: false,
      reason: "merged",
    };
  }

  if (!inReviewQueue) {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "not_in_review",
      ambiguous: false,
      reason: "not_in_review_queue",
    };
  }

  if (routing === "human") {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: true,
      needsAgentReview: false,
      shouldSkipReview: false,
      prStatus,
      canonicalState: "awaiting_human_review",
      ambiguous: false,
      reason: "awaiting_human_review",
    };
  }

  if (routing === "skip") {
    return {
      stateLabel,
      routing,
      inReviewQueue,
      needsHumanReview: false,
      needsAgentReview: false,
      shouldSkipReview: true,
      prStatus,
      canonicalState: "review_skipped",
      ambiguous: false,
      reason: "review_skipped",
    };
  }

  return {
    stateLabel,
    routing,
    inReviewQueue,
    needsHumanReview: false,
    needsAgentReview: true,
    shouldSkipReview: false,
    prStatus,
    canonicalState: "awaiting_agent_review",
    ambiguous: false,
    reason: routing === "agent" ? "awaiting_agent_review" : "default_agent_review",
  };
}

export function getStaleReviewLabels(issue: Issue, status: CanonicalReviewStatus): string[] {
  const reviewLabels = issue.labels.filter((label) => label.startsWith("review:"));
  if (reviewLabels.length === 0) return [];

  if (status.ambiguous || status.canonicalState === "changes_requested" || status.canonicalState === "merge_conflict" || status.canonicalState === "pr_closed" || status.canonicalState === "merged") {
    return reviewLabels;
  }

  if (!status.inReviewQueue && status.prStatus.state === PrState.CLOSED && !status.prStatus.url) {
    return reviewLabels;
  }

  return [];
}
