/**
 * issue-dedup.ts — deterministic duplicate issue preflight checks.
 *
 * Keeps provider logic transport-focused and lets task creation paths decide
 * whether a new issue should proceed, warn, or pause for explicit confirmation.
 */
import type { Issue } from "../providers/provider.js";
import { type WorkflowConfig, StateType } from "../workflow/index.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "that", "the", "to", "with",
  "add", "create", "implement", "issue", "task", "work", "update",
]);

export type DuplicateConfidence = "high" | "medium" | "low";

export type DuplicateCandidate = {
  issueId: number;
  title: string;
  url: string;
  stateLabel: string | null;
  confidence: DuplicateConfidence;
  score: number;
  reasons: string[];
};

export type DuplicateCheckResult = {
  confidence: DuplicateConfidence;
  shouldRequireConfirmation: boolean;
  shouldBlockWithoutConfirmation: boolean;
  candidates: DuplicateCandidate[];
  summary: string;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function sharedTokens(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = [];
  for (const token of a) if (b.has(token)) shared.push(token);
  return shared.sort();
}

function getNonTerminalStateLabels(workflow: WorkflowConfig): Set<string> {
  return new Set(
    Object.values(workflow.states)
      .filter((state) => state.type !== StateType.TERMINAL)
      .map((state) => state.label),
  );
}

function getCurrentStateLabel(issue: Issue, workflow: WorkflowConfig): string | null {
  const allowed = getNonTerminalStateLabels(workflow);
  return issue.labels.find((label) => allowed.has(label)) ?? null;
}

function classifyConfidence(score: number, exactTitle: boolean, titleContained: boolean, sharedTitleCount: number): DuplicateConfidence {
  if (exactTitle || (titleContained && sharedTitleCount >= 3) || sharedTitleCount >= 5 || score >= 0.78) return "high";
  if (score >= 0.52 || (titleContained && sharedTitleCount >= 2) || sharedTitleCount >= 3) return "medium";
  return "low";
}

function buildSummary(candidates: DuplicateCandidate[], requestedTitle: string): string {
  const lead = candidates[0];
  if (!lead) return `No likely duplicate found for \"${requestedTitle}\".`;
  const prefix = lead.confidence === "high" ? "Potential duplicate blocked" : "Potential duplicate needs confirmation";
  const details = candidates
    .map((candidate) => {
      const state = candidate.stateLabel ? `, state: ${candidate.stateLabel}` : "";
      const reason = candidate.reasons[0] ? ` (${candidate.reasons[0]})` : "";
      return `#${candidate.issueId} \"${candidate.title}\"${state}${reason}`;
    })
    .join("; ");
  return `${prefix}: ${details}`;
}

export function findDuplicateCandidates(
  draft: { title: string; description?: string },
  openIssues: Issue[],
  workflow: WorkflowConfig,
): DuplicateCheckResult {
  const requestedTitle = draft.title ?? "";
  const requestedDescription = draft.description ?? "";
  const requestedTitleNorm = normalize(requestedTitle);
  const requestedTitleTokens = tokenSet(requestedTitle);
  const requestedBodyTokens = tokenSet(requestedDescription);
  const candidates: DuplicateCandidate[] = [];
  const nonTerminalLabels = getNonTerminalStateLabels(workflow);

  for (const issue of openIssues) {
    const stateLabel = getCurrentStateLabel(issue, workflow);
    if (!stateLabel || !nonTerminalLabels.has(stateLabel)) continue;

    const candidateTitleNorm = normalize(issue.title);
    const candidateTitleTokens = tokenSet(issue.title);
    const candidateBodyTokens = tokenSet(issue.description ?? "");
    const titleScore = overlapScore(requestedTitleTokens, candidateTitleTokens);
    const bodyScore = overlapScore(requestedBodyTokens, candidateBodyTokens);
    const crossScore = Math.max(
      overlapScore(requestedTitleTokens, candidateBodyTokens),
      overlapScore(requestedBodyTokens, candidateTitleTokens),
    );
    const exactTitle = requestedTitleNorm.length > 0 && requestedTitleNorm === candidateTitleNorm;
    const titleContained = requestedTitleNorm.length > 0 && candidateTitleNorm.length > 0 && (
      requestedTitleNorm.includes(candidateTitleNorm) || candidateTitleNorm.includes(requestedTitleNorm)
    );
    const sharedTitle = sharedTokens(requestedTitleTokens, candidateTitleTokens);
    const score = Number((titleScore * 0.65 + bodyScore * 0.2 + crossScore * 0.15).toFixed(3));
    const confidence = classifyConfidence(score, exactTitle, titleContained, sharedTitle.length);
    if (confidence === "low") continue;

    const reasons: string[] = [];
    if (exactTitle) reasons.push("same normalized title");
    else if (titleContained) reasons.push("one normalized title contains the other");
    if (sharedTitle.length > 0) reasons.push(`shared title tokens: ${sharedTitle.join(", ")}`);
    if (bodyScore >= 0.45) reasons.push(`body similarity ${bodyScore.toFixed(2)}`);
    if (crossScore >= 0.45) reasons.push(`title/body overlap ${crossScore.toFixed(2)}`);

    candidates.push({
      issueId: issue.iid,
      title: issue.title,
      url: issue.web_url,
      stateLabel,
      confidence,
      score,
      reasons,
    });
  }

  candidates.sort((a, b) => {
    const rank = { high: 2, medium: 1, low: 0 };
    const confidenceDiff = rank[b.confidence] - rank[a.confidence];
    if (confidenceDiff !== 0) return confidenceDiff;
    if (b.score !== a.score) return b.score - a.score;
    return a.issueId - b.issueId;
  });

  const top = candidates[0];
  const confidence = top?.confidence ?? "low";
  return {
    confidence,
    shouldRequireConfirmation: confidence !== "low",
    shouldBlockWithoutConfirmation: confidence === "high" || confidence === "medium",
    candidates: candidates.slice(0, 5),
    summary: buildSummary(candidates.slice(0, 5), requestedTitle),
  };
}

export function buildDuplicateConfirmationMessage(check: DuplicateCheckResult): string {
  if (check.candidates.length === 0) return check.summary;
  const heading = check.confidence === "high"
    ? "Possible duplicate detected. Creation is paused until you confirm."
    : "This may overlap with existing work. Confirm before creating it.";
  const items = check.candidates
    .map((candidate) => `- #${candidate.issueId} ${candidate.title} (${candidate.stateLabel ?? "unknown"}, score ${candidate.score.toFixed(2)})\n  ${candidate.url}\n  Reasons: ${candidate.reasons.join("; ") || "similar title/body"}`)
    .join("\n");
  return `${heading}\n${items}`;
}
