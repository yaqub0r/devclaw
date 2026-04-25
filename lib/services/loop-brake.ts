import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { log as auditLog } from "../audit.js";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { StateType, type WorkflowConfig } from "../workflow/index.js";

const LOOP_BRAKE_WINDOW_MS = 6 * 60 * 60 * 1000;
const LOOP_BRAKE_THRESHOLD = 3;

type AuditEntry = Record<string, unknown> & {
  ts?: string;
  event?: string;
  issueId?: number;
  issue?: number;
};

export type LoopBrakeDecision = {
  blocked: boolean;
  threshold: number;
  windowMs: number;
  events: Array<{
    ts: string;
    source: string;
    stage?: string;
    event?: string;
    from?: string;
    to?: string;
    reason: string;
    rawReason?: string;
    orphanReason?: string;
    decisionPath?: string;
    countedByRule?: string;
    rawEvent?: string;
    rawStage?: string;
    rawResult?: string;
    issueFieldUsed?: string;
    rawIssueId?: number | null;
    rawIssue?: number | null;
    rawLabelPair?: string;
    matchedBecause?: string;
  }>;
  reasonHistogram: Record<string, number>;
  sourceHistogram: Record<string, number>;
};

export function getLoopBrakeHoldLabel(workflow: WorkflowConfig): string | null {
  const refining = Object.values(workflow.states).find((s) => s.type === StateType.HOLD && s.label === "Refining");
  if (refining) return refining.label;

  const nonInitialHold = Object.entries(workflow.states)
    .find(([key, s]) => s.type === StateType.HOLD && key !== workflow.initial)?.[1];
  if (nonInitialHold) return nonInitialHold.label;

  return Object.values(workflow.states).find((s) => s.type === StateType.HOLD)?.label ?? null;
}

export async function evaluateLoopBrake(
  workspaceDir: string,
  issueId: number,
): Promise<LoopBrakeDecision> {
  const entries = await readRecentAuditEntries(workspaceDir);
  const cutoff = Date.now() - LOOP_BRAKE_WINDOW_MS;
  const events = entries
    .filter((entry) => getIssueId(entry) === issueId)
    .map((entry) => toLoopEvent(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => Date.parse(entry.ts) >= cutoff)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const reasonHistogram = Object.fromEntries(
    Array.from(events.reduce((map, event) => {
      map.set(event.reason, (map.get(event.reason) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()),
  );
  const sourceHistogram = Object.fromEntries(
    Array.from(events.reduce((map, event) => {
      map.set(event.source, (map.get(event.source) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()),
  );

  return {
    blocked: events.length >= LOOP_BRAKE_THRESHOLD,
    threshold: LOOP_BRAKE_THRESHOLD,
    windowMs: LOOP_BRAKE_WINDOW_MS,
    events,
    reasonHistogram,
    sourceHistogram,
  };
}

export async function recordLoopBrakeHalt(opts: {
  workspaceDir: string;
  project: string;
  issueId: number;
  issueTitle: string;
  from: string;
  to: string;
  reason: string;
  threshold: number;
  events: LoopBrakeDecision["events"];
}): Promise<void> {
  await auditLog(opts.workspaceDir, "loop_retry_ceiling", {
    project: opts.project,
    issueId: opts.issueId,
    issueTitle: opts.issueTitle,
    from: opts.from,
    to: opts.to,
    reason: opts.reason,
    threshold: opts.threshold,
    recentEvents: opts.events,
  });
}

async function readRecentAuditEntries(workspaceDir: string): Promise<AuditEntry[]> {
  const filePath = join(workspaceDir, DATA_DIR, "log", "audit.log");
  try {
    const raw = await readFile(filePath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
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

function getIssueId(entry: AuditEntry): number | null {
  const raw = entry.issueId ?? entry.issue;
  return typeof raw === "number" ? raw : null;
}

function toLoopEvent(entry: AuditEntry): LoopBrakeDecision["events"][number] | null {
  const ts = typeof entry.ts === "string" ? entry.ts : new Date(0).toISOString();
  const event = entry.event;

  if (event === "loop_diagnostic" && entry.stage === "health_requeue") {
    const rawReason = asString(entry.loopBrakeReason) ?? asString(entry.healthRequeueLoopReason);
    return {
      ts,
      event,
      stage: asString(entry.stage),
      source: "health_requeue",
      from: asString(entry.from),
      to: asString(entry.to),
      reason: rawReason ?? "orphan_requeue",
      rawReason: rawReason ?? undefined,
      orphanReason: asString(entry.orphanReason) ?? undefined,
      decisionPath: asString(entry.decisionPath),
      countedByRule: 'count loop_diagnostic stage="health_requeue" as a non-progress orphan recovery event',
      rawEvent: event,
      rawStage: asString(entry.stage),
      rawResult: asString(entry.result),
      issueFieldUsed: typeof entry.issueId === "number" ? "issueId" : typeof entry.issue === "number" ? "issue" : "none",
      rawIssueId: typeof entry.issueId === "number" ? entry.issueId : null,
      rawIssue: typeof entry.issue === "number" ? entry.issue : null,
      rawLabelPair: `${asString(entry.from) ?? "?"} -> ${asString(entry.to) ?? "?"}`,
      matchedBecause: rawReason != null
        ? `health_requeue matched loop brake because loopBrakeReason/healthRequeueLoopReason was ${rawReason}`
        : "health_requeue matched loop brake because stage alone is counted as orphan recovery even without an explicit reason field",
    };
  }

  if (event === "loop_diagnostic" && entry.stage === "work_finish_transition" && asString(entry.to) === "Refining") {
    const rawReason = asString(entry.loopBrakeReason) ?? asString(entry.result);
    return {
      ts,
      event,
      stage: asString(entry.stage),
      source: "work_finish_transition",
      from: asString(entry.from),
      to: asString(entry.to),
      reason: rawReason ?? "blocked",
      rawReason: rawReason ?? undefined,
      decisionPath: asString(entry.decisionPath),
      countedByRule: 'count loop_diagnostic stage="work_finish_transition" to="Refining" as a non-progress worker completion loop event',
      rawEvent: event,
      rawStage: asString(entry.stage),
      rawResult: asString(entry.result),
      issueFieldUsed: typeof entry.issueId === "number" ? "issueId" : typeof entry.issue === "number" ? "issue" : "none",
      rawIssueId: typeof entry.issueId === "number" ? entry.issueId : null,
      rawIssue: typeof entry.issue === "number" ? entry.issue : null,
      rawLabelPair: `${asString(entry.from) ?? "?"} -> ${asString(entry.to) ?? "?"}`,
      matchedBecause: rawReason != null
        ? `work_finish_transition matched loop brake because it reached Refining with reason/result ${rawReason}`
        : "work_finish_transition matched loop brake because any direct transition into Refining counts as non-progress even without an explicit reason field",
    };
  }

  if (event === "review_transition") {
    const reason = asString(entry.reason);
    if (["pr_comments", "changes_requested", "merge_conflict", "merge_failed", "pr_closed"].includes(reason ?? "")) {
      return {
        ts,
        event,
        source: "review_transition",
        from: asString(entry.from),
        to: asString(entry.to),
        reason: reason!,
        rawReason: reason!,
        decisionPath: asString(entry.summary) ?? asString(entry.note),
        countedByRule: `count review_transition reason="${reason}" as a non-progress review loop event`,
        rawEvent: event,
        rawStage: asString(entry.stage),
        rawResult: asString(entry.result),
        issueFieldUsed: typeof entry.issueId === "number" ? "issueId" : typeof entry.issue === "number" ? "issue" : "none",
        rawIssueId: typeof entry.issueId === "number" ? entry.issueId : null,
        rawIssue: typeof entry.issue === "number" ? entry.issue : null,
        rawLabelPair: `${asString(entry.from) ?? "?"} -> ${asString(entry.to) ?? "?"}`,
        matchedBecause: `review_transition matched loop brake because reason=${reason} is listed as a non-progress review event`,
      };
    }
  }

  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
