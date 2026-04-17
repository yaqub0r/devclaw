/**
 * review-loop.ts — Detect poisoned review/dev feedback loops.
 *
 * Uses recent audit log history to identify repeated returns to the same
 * feedback queue for the same issue and PR branch, then escalates to a human
 * intervention state instead of endlessly redispatching.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";

const DEFAULT_ESCALATION_THRESHOLD = 3;

type AuditEntry = {
  event?: string;
  issueId?: number;
  issue?: number;
  to?: string;
  reason?: string;
  prUrl?: string | null;
  sourceBranch?: string | null;
};

export type ReviewLoopAssessment = {
  shouldEscalate: boolean;
  threshold: number;
  repeatedCycles: number;
  fingerprint: string;
  correlatedBy: "branch" | "pr" | "issue";
};

export async function assessReviewLoop(opts: {
  workspaceDir: string;
  issueId: number;
  prUrl?: string | null;
  sourceBranch?: string | null;
  threshold?: number;
}): Promise<ReviewLoopAssessment> {
  const threshold = opts.threshold ?? DEFAULT_ESCALATION_THRESHOLD;
  const entries = await readAuditEntries(opts.workspaceDir);
  const fingerprint = normalizeFingerprint(opts.sourceBranch, opts.prUrl, opts.issueId);
  const correlatedBy = opts.sourceBranch ? "branch" : opts.prUrl ? "pr" : "issue";

  let repeatedCycles = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const entryIssueId = entry.issueId ?? entry.issue;
    if (entryIssueId !== opts.issueId) continue;
    if (!isFeedbackReturn(entry)) continue;

    const entryFingerprint = normalizeFingerprint(entry.sourceBranch, entry.prUrl, opts.issueId);
    if (entryFingerprint !== fingerprint) break;
    repeatedCycles++;
  }

  return {
    shouldEscalate: repeatedCycles + 1 >= threshold,
    threshold,
    repeatedCycles,
    fingerprint,
    correlatedBy,
  };
}

function isFeedbackReturn(entry: AuditEntry): boolean {
  if (entry.event === "review_loop_escalated") return true;
  if (entry.event !== "review_transition") return false;
  return entry.to === "To Improve" || entry.to === "Refining";
}

function normalizeFingerprint(sourceBranch: string | null | undefined, prUrl: string | null | undefined, issueId: number): string {
  if (sourceBranch && sourceBranch.trim()) return `branch:${sourceBranch.trim()}`;
  if (prUrl && prUrl.trim()) return `pr:${prUrl.trim()}`;
  return `issue:${issueId}`;
}

async function readAuditEntries(workspaceDir: string): Promise<AuditEntry[]> {
  const auditPath = join(workspaceDir, DATA_DIR, "log", "audit.log");
  try {
    const content = await readFile(auditPath, "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AuditEntry => entry !== null);
  } catch {
    return [];
  }
}
