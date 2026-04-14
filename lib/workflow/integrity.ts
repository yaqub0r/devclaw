import { PrState, type Issue, type IssuePrSummary } from "../providers/provider.js";
import { StateType, type WorkflowConfig } from "./types.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "be", "by", "cite", "cites", "citing", "clarify", "docs", "doc", "documentation",
  "for", "from", "in", "into", "is", "note", "the", "to", "update", "with",
]);

export type DuplicateCandidate = {
  issue: Issue;
  score: number;
  overlappingTokens: string[];
};

function normalizeToken(token: string): string {
  let value = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (value.endsWith("ing") && value.length > 5) value = value.slice(0, -3);
  else if (value.endsWith("ed") && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith("es") && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith("s") && value.length > 3) value = value.slice(0, -1);
  return value;
}

export function tokenizeSemanticText(text: string): string[] {
  return [...new Set(
    text
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )];
}

export function semanticSimilarity(a: string, b: string): { score: number; overlappingTokens: string[] } {
  const aTokens = tokenizeSemanticText(a);
  const bTokens = tokenizeSemanticText(b);
  if (aTokens.length === 0 || bTokens.length === 0) return { score: 0, overlappingTokens: [] };

  const bSet = new Set(bTokens);
  const overlap = aTokens.filter((token) => bSet.has(token));
  const union = new Set([...aTokens, ...bTokens]);
  return {
    score: overlap.length / union.size,
    overlappingTokens: overlap.sort(),
  };
}

export function findSemanticDuplicateIssues(
  proposed: { title: string; description?: string },
  openIssues: Issue[],
  opts?: { minScore?: number },
): DuplicateCandidate[] {
  const proposedText = [proposed.title, proposed.description ?? ""].join(" ").trim();
  const minScore = opts?.minScore ?? 0.45;

  return openIssues
    .map((issue) => {
      const compared = semanticSimilarity(proposedText, [issue.title, issue.description].join(" "));
      const exactTitleBoost = issue.title.trim().toLowerCase() === proposed.title.trim().toLowerCase() ? 1 : 0;
      return {
        issue,
        score: Math.max(compared.score, exactTitleBoost),
        overlappingTokens: compared.overlappingTokens,
      };
    })
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score || a.issue.iid - b.issue.iid);
}

export function getNonTerminalStateLabels(workflow: WorkflowConfig): string[] {
  return Object.values(workflow.states)
    .filter((state) => state.type !== StateType.TERMINAL)
    .map((state) => state.label);
}

const PR_PRIORITY: Record<string, number> = {
  [PrState.APPROVED]: 5,
  [PrState.OPEN]: 4,
  [PrState.HAS_COMMENTS]: 3,
  [PrState.CHANGES_REQUESTED]: 2,
  [PrState.MERGED]: 1,
  [PrState.CLOSED]: 0,
};

export function rankIssuePrs(prs: IssuePrSummary[]): IssuePrSummary[] {
  return [...prs].sort((a, b) => {
    const byState = (PR_PRIORITY[b.state] ?? -1) - (PR_PRIORITY[a.state] ?? -1);
    if (byState !== 0) return byState;
    if ((a.mergeable ?? false) !== (b.mergeable ?? false)) return Number(b.mergeable ?? false) - Number(a.mergeable ?? false);
    return a.url.localeCompare(b.url);
  }).map((pr, index) => ({ ...pr, isCanonical: index === 0 }));
}

export function summarizePrDrift(prs: IssuePrSummary[]): {
  canonical: IssuePrSummary | null;
  active: IssuePrSummary[];
  hasMultipleActive: boolean;
  hasDirtyReviewState: boolean;
} {
  const ranked = rankIssuePrs(prs);
  const active = ranked.filter((pr) => pr.state !== PrState.CLOSED && pr.state !== PrState.MERGED);
  const canonical = ranked[0] ?? null;
  return {
    canonical,
    active,
    hasMultipleActive: active.length > 1,
    hasDirtyReviewState: active.some((pr) => pr.mergeable === false),
  };
}
