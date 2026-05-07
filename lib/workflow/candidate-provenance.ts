import type { IssueProvider, IssueComment } from "../providers/provider.js";
import type { RunCommand } from "../context.js";

const MARKER = "devclaw:candidate-record";
const DECISION_MARKER = "devclaw:candidate-decision";

export type CandidateStatus = "active" | "accepted" | "invalidated";

export type CandidateRecord = {
  issueId: number;
  prUrl?: string | null;
  commitSha?: string | null;
  candidateId?: string | null;
  targetHint?: string | null;
  status: CandidateStatus;
  promotedAt?: string;
  acceptedAt?: string;
  invalidatedAt?: string;
  reason?: string | null;
};

export type CandidateDecision = {
  issueId: number;
  status: Exclude<CandidateStatus, "active">;
  candidateId?: string | null;
  decidedAt: string;
  reason?: string | null;
};

export async function getCurrentCandidate(provider: IssueProvider, issueId: number): Promise<CandidateRecord | null> {
  const comments = await provider.listComments(issueId);
  return findLatestCandidateRecord(comments);
}

export async function recordPromotedCandidate(opts: {
  provider: IssueProvider;
  issueId: number;
  repoPath: string;
  runCommand: RunCommand;
  prUrl?: string | null;
  targetHint?: string | null;
}): Promise<CandidateRecord> {
  const commitSha = await getHeadSha(opts.repoPath, opts.runCommand);
  const promotedAt = new Date().toISOString();
  const candidateId = commitSha ? commitSha.slice(0, 12) : `issue-${opts.issueId}-${Date.now()}`;
  const record: CandidateRecord = {
    issueId: opts.issueId,
    prUrl: opts.prUrl ?? null,
    commitSha,
    candidateId,
    targetHint: opts.targetHint ?? null,
    status: "active",
    promotedAt,
  };
  await opts.provider.addComment(opts.issueId, renderCandidateRecord(record));
  return record;
}

export async function markCandidateStatus(opts: {
  provider: IssueProvider;
  issueId: number;
  status: Exclude<CandidateStatus, "active">;
  reason?: string;
}): Promise<CandidateRecord | null> {
  const current = await getCurrentCandidate(opts.provider, opts.issueId);
  if (!current) return null;
  const now = new Date().toISOString();
  const next: CandidateRecord = {
    ...current,
    status: opts.status,
    acceptedAt: opts.status === "accepted" ? now : current.acceptedAt,
    invalidatedAt: opts.status === "invalidated" ? now : current.invalidatedAt,
    reason: opts.reason ?? current.reason ?? null,
  };
  await opts.provider.addComment(opts.issueId, renderCandidateRecord(next));
  return next;
}

export function renderCandidateRecord(record: CandidateRecord): string {
  const payload = JSON.stringify(record);
  const lines = [
    `<!-- ${MARKER} ${payload} -->`,
    "## DevClaw Candidate Record",
    "",
    `- status: ${record.status}`,
    `- candidate: ${record.candidateId ?? "unknown"}`,
    `- commit: ${record.commitSha ?? "unknown"}`,
    `- target: ${record.targetHint ?? "unspecified"}`,
  ];
  if (record.prUrl) lines.push(`- PR: ${record.prUrl}`);
  if (record.reason) lines.push(`- reason: ${record.reason}`);
  return lines.join("\n");
}

export function renderCandidateDecision(decision: CandidateDecision): string {
  const payload = JSON.stringify(decision);
  const lines = [
    `<!-- ${DECISION_MARKER} ${payload} -->`,
    "## DevClaw Candidate Decision",
    "",
    `- status: ${decision.status}`,
    `- candidate: ${decision.candidateId ?? "current"}`,
  ];
  if (decision.reason) lines.push(`- reason: ${decision.reason}`);
  return lines.join("\n");
}

function findLatestCandidateRecord(comments: IssueComment[]): CandidateRecord | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    const decision = parseCandidateDecision(comment?.body ?? "");
    if (decision) {
      const base = findLatestCandidateBase(comments, i - 1, decision.candidateId ?? undefined);
      if (!base) continue;
      return applyDecision(base, decision);
    }

    const record = parseCandidateRecord(comment?.body ?? "");
    if (record) return record;
  }
  return null;
}

function findLatestCandidateBase(comments: IssueComment[], startIndex: number, candidateId?: string): CandidateRecord | null {
  for (let i = startIndex; i >= 0; i--) {
    const record = parseCandidateRecord(comments[i]?.body ?? "");
    if (!record) continue;
    if (!candidateId || !record.candidateId || record.candidateId === candidateId) return record;
  }
  return null;
}

function applyDecision(record: CandidateRecord, decision: CandidateDecision): CandidateRecord {
  return {
    ...record,
    status: decision.status,
    acceptedAt: decision.status === "accepted" ? decision.decidedAt : record.acceptedAt,
    invalidatedAt: decision.status === "invalidated" ? decision.decidedAt : record.invalidatedAt,
    reason: decision.reason ?? record.reason ?? null,
  };
}

function parseCandidateRecord(body: string): CandidateRecord | null {
  const match = body.match(new RegExp(`<!--\\s*${MARKER}\\s+(.+?)\\s*-->`));
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as CandidateRecord;
  } catch {
    return null;
  }
}

function parseCandidateDecision(body: string): CandidateDecision | null {
  const match = body.match(new RegExp(`<!--\\s*${DECISION_MARKER}\\s+(.+?)\\s*-->`));
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as CandidateDecision;
  } catch {
    return null;
  }
}

async function getHeadSha(repoPath: string, runCommand: RunCommand): Promise<string | null> {
  try {
    const result = await runCommand(["git", "rev-parse", "HEAD"], { cwd: repoPath, timeoutMs: 10_000 });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}
