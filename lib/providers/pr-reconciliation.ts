import { PrState, type PrStatus } from './provider.js';

type PrCandidate = {
  url: string;
  title?: string;
  sourceBranch?: string;
  state: string;
  reviewDecision?: string | null;
  mergeable?: boolean;
  mergedAt?: string | null;
  number?: number;
};

function toStatus(candidate: PrCandidate, state: PrState): PrStatus {
  return {
    state,
    url: candidate.url,
    title: candidate.title,
    sourceBranch: candidate.sourceBranch,
    mergeable: candidate.mergeable,
  };
}

function buildAmbiguous(reason: NonNullable<PrStatus['reason']>, candidates: PrCandidate[]): PrStatus {
  const preferred = [...candidates].sort((a, b) => {
    const aTime = a.mergedAt ? new Date(a.mergedAt).getTime() : 0;
    const bTime = b.mergedAt ? new Date(b.mergedAt).getTime() : 0;
    return bTime - aTime || (b.number ?? 0) - (a.number ?? 0);
  })[0];
  return {
    state:
      reason === 'multiple_open_prs' ? PrState.OPEN :
      reason === 'multiple_merged_prs' ? PrState.MERGED :
      PrState.CLOSED,
    url: preferred?.url ?? null,
    title: preferred?.title,
    sourceBranch: preferred?.sourceBranch,
    mergeable: preferred?.mergeable,
    ambiguous: true,
    reason,
    candidates: candidates.map((candidate) => ({
      url: candidate.url,
      state: candidate.state,
      title: candidate.title,
      sourceBranch: candidate.sourceBranch,
    })),
  };
}

export function reconcileCanonicalPr(opts: {
  open: PrCandidate[];
  merged: PrCandidate[];
  closed: PrCandidate[];
}): PrStatus {
  const { open, merged, closed } = opts;

  if (open.length > 1) return buildAmbiguous('multiple_open_prs', open);
  if (open.length === 1) return toStatus(open[0]!, PrState.OPEN);

  if (merged.length > 1) return buildAmbiguous('multiple_merged_prs', merged);
  if (merged.length === 1) return toStatus(merged[0]!, PrState.MERGED);

  if (closed.length > 1) return buildAmbiguous('multiple_closed_prs', closed);
  if (closed.length === 1) return toStatus(closed[0]!, PrState.CLOSED);

  return { state: PrState.CLOSED, url: null };
}
