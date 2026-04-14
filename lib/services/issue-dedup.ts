export type DuplicateCandidate = {
  iid: number;
  title: string;
  labels: string[];
  state?: string;
  similarity: number;
  titleOverlap: number;
  bodyOverlap: number;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "that", "the", "to", "with", "while", "when", "work", "task", "issue",
  "add", "update", "fix",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const as = new Set(a);
  const bs = new Set(b);
  let intersection = 0;
  for (const token of as) {
    if (bs.has(token)) intersection++;
  }
  const union = new Set([...as, ...bs]).size;
  return union === 0 ? 0 : intersection / union;
}

export function findLikelyDuplicateIssues(
  draft: { title: string; description?: string },
  openIssues: Array<{ iid: number; title: string; description?: string; labels?: string[]; state?: string }>,
): DuplicateCandidate[] {
  const draftTitle = tokenize(draft.title);
  const draftBody = tokenize(draft.description ?? "");

  return openIssues
    .map((issue) => {
      const titleOverlap = overlapScore(draftTitle, tokenize(issue.title));
      const bodyOverlap = overlapScore(draftBody, tokenize(issue.description ?? ""));
      const similarity = titleOverlap * 0.75 + bodyOverlap * 0.25;
      return {
        iid: issue.iid,
        title: issue.title,
        labels: issue.labels ?? [],
        state: issue.state,
        similarity,
        titleOverlap,
        bodyOverlap,
      } satisfies DuplicateCandidate;
    })
    .filter((candidate) => candidate.similarity >= 0.35 || candidate.titleOverlap >= 0.5)
    .sort((a, b) => b.similarity - a.similarity || b.titleOverlap - a.titleOverlap || a.iid - b.iid);
}
