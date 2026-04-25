import { readFile, stat } from "node:fs/promises";
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

function buildEventAuditExcerpt(entry: AuditEntry): Record<string, unknown> {
  return {
    ts: typeof entry.ts === "string" ? entry.ts : null,
    event: typeof entry.event === "string" ? entry.event : null,
    stage: asString(entry.stage) ?? null,
    result: asString(entry.result) ?? null,
    from: asString(entry.from) ?? null,
    to: asString(entry.to) ?? null,
    reason: asString(entry.reason) ?? null,
    sourceBranch: asString(entry.sourceBranch) ?? null,
    repoPath: asString(entry.repoPath) ?? null,
    pluginSourceRoot: asString(entry.pluginSourceRoot) ?? null,
    loopBrakeReason: asString(entry.loopBrakeReason) ?? null,
    healthRequeueLoopReason: asString(entry.healthRequeueLoopReason) ?? null,
    orphanReason: asString(entry.orphanReason) ?? null,
    transitionReasonCategory: asString(entry.transitionReasonCategory) ?? null,
    refiningDecisionPath: asString(entry.refiningDecisionPath) ?? null,
    healthDecisionCategory: asString(entry.healthDecisionCategory) ?? null,
    healthDecisionSummary: asString(entry.healthDecisionSummary) ?? null,
    branchResolutionDecision: asString(entry.branchResolutionDecision) ?? null,
    prValidationDecision: asString(entry.prValidationDecision) ?? null,
    prValidationLookupOutcome: asString(entry.prValidationLookupOutcome) ?? null,
    branchResolutionPreferredSource: asString(entry.branchResolutionPreferredSource) ?? asString(entry.preferredBranchSource) ?? null,
    branchResolutionPreferredEvidence: asString(entry.branchResolutionPreferredEvidence) ?? null,
    preferredBranchConfidence: asString(entry.preferredBranchConfidence) ?? null,
    branchSelectionWinnerSummary: asString(entry.branchSelectionWinnerSummary) ?? null,
    branchWinnerDecisionSummary: asString(entry.branchWinnerDecisionSummary) ?? null,
    branchWinnerComparedToLaneSummary: asString(entry.branchWinnerComparedToLaneSummary) ?? null,
    prValidationBranchResolutionPreferredSource: asString(entry.prValidationBranchResolutionPreferredSource) ?? null,
    prValidationPreferredBranchConfidence: asString(entry.prValidationPreferredBranchConfidence) ?? null,
    prValidationBranchResolutionPreferredEvidence: asString(entry.prValidationBranchResolutionPreferredEvidence) ?? null,
    prValidationLookupTargetingDecision: asString(entry.prValidationLookupTargetingDecision) ?? null,
    prValidationLookupTargetingSummary: isRecord(entry.prValidationLookupTargetingSummary) ? entry.prValidationLookupTargetingSummary : null,
    prValidationConfiguredProviderTargetRepo: asString(entry.prValidationConfiguredProviderTargetRepo) ?? null,
    prValidationRepoAmbientGhTarget: asString(entry.prValidationRepoAmbientGhTarget) ?? null,
    prValidationPluginAmbientGhTarget: asString(entry.prValidationPluginAmbientGhTarget) ?? null,
    prValidationRepoAmbientLinkedPrCount: asNumber(entry.prValidationRepoAmbientLinkedPrCount),
    prValidationPluginAmbientLinkedPrCount: asNumber(entry.prValidationPluginAmbientLinkedPrCount),
    prValidationConfiguredTargetLinkedPrCount: asNumber(entry.prValidationConfiguredTargetLinkedPrCount),
    prValidationLookupProbeDecision: asString(entry.prValidationLookupProbeDecision) ?? null,
    prValidationLookupProbeSummary: isRecord(entry.prValidationLookupProbeSummary) ? entry.prValidationLookupProbeSummary : null,
    prValidationDetectedBranch: asString(entry.prValidationDetectedBranch) ?? null,
    prValidationDetectedBranchSource: asString(entry.prValidationDetectedBranchSource) ?? null,
    prValidationDetectedBranchDecisionSummary: asString(entry.prValidationDetectedBranchDecisionSummary) ?? null,
    prValidationDetectedBranchMismatchReasons: Array.isArray(entry.prValidationDetectedBranchMismatchReasons) ? entry.prValidationDetectedBranchMismatchReasons : null,
    prValidationBranchSelectionWinnerSummary: asString(entry.prValidationBranchSelectionWinnerSummary) ?? null,
    prValidationBranchWinnerDecisionSummary: asString(entry.prValidationBranchWinnerDecisionSummary) ?? null,
    prValidationBranchWinnerComparedToLaneSummary: asString(entry.prValidationBranchWinnerComparedToLaneSummary) ?? null,
    prValidationLaneMismatchSummary: asString(entry.prValidationLaneMismatchSummary) ?? null,
    prValidationLaneMismatchCategory: asString(entry.prValidationLaneMismatchCategory) ?? null,
    liveSourceDecision: asString(entry.liveSourceDecision) ?? null,
    liveSourceSingularitySummary: asString(entry.liveSourceSingularitySummary) ?? null,
    openclawConfigInstallSourcePath: asString(entry.openclawConfigInstallSourcePath) ?? null,
    openclawConfigInstallSourceRealPath: asString(entry.openclawConfigInstallSourceRealPath) ?? null,
    openclawConfigInstallPath: asString(entry.openclawConfigInstallPath) ?? null,
    openclawConfigInstallPathRealPath: asString(entry.openclawConfigInstallPathRealPath) ?? null,
    openclawConfigPluginLoadPaths: Array.isArray(entry.openclawConfigPluginLoadPaths) ? entry.openclawConfigPluginLoadPaths : null,
    openclawConfigPluginLoadPathRealPaths: Array.isArray(entry.openclawConfigPluginLoadPathRealPaths) ? entry.openclawConfigPluginLoadPathRealPaths : null,
    branchResolutionMismatchFlags: isRecord(entry.branchResolutionMismatchFlags) ? entry.branchResolutionMismatchFlags : null,
    liveSourceAgreementMatrix: isRecord(entry.liveSourceAgreementMatrix) ? entry.liveSourceAgreementMatrix : null,
    laneIdentitySummary: isRecord(entry.laneIdentitySummary) ? entry.laneIdentitySummary : null,
    branchSelectionDecisionTrace: isRecord(entry.branchSelectionDecisionTrace) ? entry.branchSelectionDecisionTrace : null,
    duplicateSourceDecision: asString(entry.duplicateSourceDecision) ?? null,
    duplicateSourceWinningRealPathGuess: asString(entry.duplicateSourceWinningRealPathGuess) ?? null,
    duplicateSourceCompetingRealPaths: Array.isArray(entry.duplicateSourceCompetingRealPaths) ? entry.duplicateSourceCompetingRealPaths : null,
    laneMismatchSummary: asString(entry.laneMismatchSummary) ?? null,
    laneMismatchCategory: asString(entry.laneMismatchCategory) ?? null,
    branchSourceCandidateDecisionTable: Array.isArray(entry.branchSourceCandidateDecisionTable) ? entry.branchSourceCandidateDecisionTable : null,
    branchSourceCandidateDiagnostics: Array.isArray(entry.branchSourceCandidateDiagnostics) ? entry.branchSourceCandidateDiagnostics : null,
    branchSourceCandidatesInPriorityOrder: Array.isArray(entry.branchSourceCandidatesInPriorityOrder) ? entry.branchSourceCandidatesInPriorityOrder : null,
    repoSnapshot: isRecord(entry.repoSnapshot) ? entry.repoSnapshot : null,
    pluginSnapshot: isRecord(entry.pluginSnapshot) ? entry.pluginSnapshot : null,
    canRequeueIssue: typeof entry.canRequeueIssue === "boolean" ? entry.canRequeueIssue : null,
    duplicateSourceRisk: typeof entry.duplicateSourceRisk === "boolean" ? entry.duplicateSourceRisk : null,
    issueId: typeof entry.issueId === "number" ? entry.issueId : null,
    issue: typeof entry.issue === "number" ? entry.issue : null,
  };
}

export type LoopBrakeDecision = {
  blocked: boolean;
  threshold: number;
  windowMs: number;
  auditScan: {
    filePath: string;
    fileExists: boolean;
    fileSizeBytes: number | null;
    fileMtime: string | null;
    totalEntriesRead: number;
    issueEntriesSeen: number;
    matchedLoopEventsBeforeWindow: number;
    matchedLoopEventsInsideWindow: number;
    skippedBecauseIssueDidNotMatch: number;
    skippedBecauseNoLoopRuleMatched: number;
    skippedBecauseOutsideWindow: number;
    matchOutcomeCategory: string;
    matchOutcomeSummary: string;
    newestMatchedEventTs: string | null;
    oldestMatchedEventTs: string | null;
    newestMatchedEventInsideWindowTs: string | null;
    newestMatchedEventReason: string | null;
    newestIssueEntryTs: string | null;
    newestIssueEntryEvent: string | null;
    newestIssueEntryStage: string | null;
    newestIssueEntrySummary: string | null;
    newestNonMatchingIssueEntryTs: string | null;
    newestNonMatchingIssueEntryEvent: string | null;
    newestNonMatchingIssueEntryStage: string | null;
    newestNonMatchingIssueEntrySummary: string | null;
    recentIssueEntryExcerpts: Array<Record<string, unknown>>;
    recentNonMatchingIssueEntryExcerpts: Array<Record<string, unknown>>;
  };
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
    rawLoopBrakeReason?: string;
    rawTransitionReasonCategory?: string;
    rawRefiningDecisionPath?: string;
    rawHealthDecisionCategory?: string;
    eventShapeSummary?: string;
    compactDecisionSummary?: string;
    rawHealthDecisionSummary?: string;
    rawBranchWinnerSummary?: string;
    rawDuplicateSourceDecision?: string;
    rawPreferredBranchSource?: string;
    rawBranchResolutionPreferredEvidence?: string;
    rawPreferredBranchConfidence?: string;
    rawLaneMismatchSummary?: string;
    rawLaneMismatchCategory?: string;
    rawDuplicateSourceRisk?: boolean | null;
    rawCanRequeueIssue?: boolean | null;
    rawAuditExcerpt?: Record<string, unknown>;
    rawSourceBranch?: string;
    rawRepoPath?: string;
    rawPluginSourceRoot?: string;
    rawBranchResolutionDecision?: string;
    rawPrValidationDecision?: string;
    rawPrValidationLookupOutcome?: string;
    rawLiveSourceDecision?: string;
    rawLiveSourceSingularitySummary?: string;
    rawOpenclawConfigInstallSourcePath?: string;
    rawOpenclawConfigInstallSourceRealPath?: string;
    rawOpenclawConfigInstallPath?: string;
    rawOpenclawConfigInstallPathRealPath?: string;
    rawOpenclawConfigPluginLoadPaths?: unknown[] | null;
    rawOpenclawConfigPluginLoadPathRealPaths?: unknown[] | null;
    rawBranchResolutionMismatchFlags?: Record<string, unknown> | null;
    rawLiveSourceAgreementMatrix?: Record<string, unknown> | null;
    rawLaneIdentitySummary?: Record<string, unknown> | null;
    rawBranchSelectionDecisionTrace?: Record<string, unknown> | null;
    rawDuplicateSourceWinningRealPathGuess?: string;
    rawDuplicateSourceCompetingRealPaths?: unknown[] | null;
    rawBranchSourceCandidateDecisionTable?: unknown[] | null;
    rawPrValidationBranchResolutionPreferredSource?: string;
    rawPrValidationPreferredBranchConfidence?: string;
    rawPrValidationBranchResolutionPreferredEvidence?: string;
    rawPrValidationBranchSelectionWinnerSummary?: string;
    rawPrValidationBranchWinnerDecisionSummary?: string;
    rawPrValidationBranchWinnerComparedToLaneSummary?: string;
    rawPrValidationLaneMismatchSummary?: string;
    rawPrValidationLaneMismatchCategory?: string;
    rawPrValidationDetectedBranch?: string;
    rawPrValidationDetectedBranchSource?: string;
    rawPrValidationDetectedBranchDecisionSummary?: string;
    rawPrValidationDetectedBranchMismatchReasons?: unknown[] | null;
    rawPrValidationBranchSourceCandidateDecisionTable?: unknown[] | null;
    rawRepoSnapshot?: Record<string, unknown> | null;
    rawPluginSnapshot?: Record<string, unknown> | null;
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
  const { filePath, entries, fileExists, fileSizeBytes, fileMtime } = await readRecentAuditEntries(workspaceDir);
  const cutoff = Date.now() - LOOP_BRAKE_WINDOW_MS;
  const issueEntries = entries.filter((entry) => getIssueId(entry) === issueId);
  const loopEventCandidates = issueEntries
    .map((entry) => toLoopEvent(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const nonMatchingIssueEntries = issueEntries.filter((entry) => toLoopEvent(entry) === null);
  const events = loopEventCandidates
    .filter((entry) => Date.parse(entry.ts) >= cutoff)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const newestMatchedEvent = [...loopEventCandidates].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0] ?? null;
  const oldestMatchedEvent = [...loopEventCandidates].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0] ?? null;
  const newestMatchedEventInsideWindow = [...events].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0] ?? null;
  const newestIssueEntry = [...issueEntries].sort((a, b) => Date.parse(typeof b.ts === "string" ? b.ts : new Date(0).toISOString()) - Date.parse(typeof a.ts === "string" ? a.ts : new Date(0).toISOString()))[0] ?? null;
  const newestNonMatchingIssueEntry = [...nonMatchingIssueEntries].sort((a, b) => Date.parse(typeof b.ts === "string" ? b.ts : new Date(0).toISOString()) - Date.parse(typeof a.ts === "string" ? a.ts : new Date(0).toISOString()))[0] ?? null;
  const matchOutcomeCategory =
    issueEntries.length === 0
      ? "no_issue_history"
      : loopEventCandidates.length === 0
        ? "issue_history_present_but_non_matching"
        : events.length === 0
          ? "matching_history_outside_retry_window"
          : "matching_history_inside_retry_window";
  const matchOutcomeSummary =
    matchOutcomeCategory === "no_issue_history"
      ? "audit log contained no entries tagged to this issue"
      : matchOutcomeCategory === "issue_history_present_but_non_matching"
        ? `audit log contained ${issueEntries.length} issue-tagged entries, but none matched loop-brake counting rules`
        : matchOutcomeCategory === "matching_history_outside_retry_window"
          ? `audit log contained ${loopEventCandidates.length} loop-rule matches for this issue, but all were older than the retry window`
          : `audit log contained ${events.length} loop-rule matches for this issue inside the retry window`;

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
    auditScan: {
      filePath,
      fileExists,
      fileSizeBytes,
      fileMtime,
      totalEntriesRead: entries.length,
      issueEntriesSeen: issueEntries.length,
      matchedLoopEventsBeforeWindow: loopEventCandidates.length,
      matchedLoopEventsInsideWindow: events.length,
      skippedBecauseIssueDidNotMatch: entries.length - issueEntries.length,
      skippedBecauseNoLoopRuleMatched: issueEntries.length - loopEventCandidates.length,
      skippedBecauseOutsideWindow: loopEventCandidates.length - events.length,
      matchOutcomeCategory,
      matchOutcomeSummary,
      newestMatchedEventTs: newestMatchedEvent?.ts ?? null,
      oldestMatchedEventTs: oldestMatchedEvent?.ts ?? null,
      newestMatchedEventInsideWindowTs: newestMatchedEventInsideWindow?.ts ?? null,
      newestMatchedEventReason: newestMatchedEvent?.reason ?? null,
      newestIssueEntryTs: typeof newestIssueEntry?.ts === "string" ? newestIssueEntry.ts : null,
      newestIssueEntryEvent: typeof newestIssueEntry?.event === "string" ? newestIssueEntry.event : null,
      newestIssueEntryStage: asString(newestIssueEntry?.stage) ?? null,
      newestIssueEntrySummary: newestIssueEntry ? summarizeIssueEntry(newestIssueEntry) : null,
      newestNonMatchingIssueEntryTs: typeof newestNonMatchingIssueEntry?.ts === "string" ? newestNonMatchingIssueEntry.ts : null,
      newestNonMatchingIssueEntryEvent: typeof newestNonMatchingIssueEntry?.event === "string" ? newestNonMatchingIssueEntry.event : null,
      newestNonMatchingIssueEntryStage: asString(newestNonMatchingIssueEntry?.stage) ?? null,
      newestNonMatchingIssueEntrySummary: newestNonMatchingIssueEntry ? summarizeIssueEntry(newestNonMatchingIssueEntry) : null,
      recentIssueEntryExcerpts: [...issueEntries]
        .sort((a, b) => Date.parse(typeof b.ts === "string" ? b.ts : new Date(0).toISOString()) - Date.parse(typeof a.ts === "string" ? a.ts : new Date(0).toISOString()))
        .slice(0, 5)
        .map((entry) => buildEventAuditExcerpt(entry)),
      recentNonMatchingIssueEntryExcerpts: [...nonMatchingIssueEntries]
        .sort((a, b) => Date.parse(typeof b.ts === "string" ? b.ts : new Date(0).toISOString()) - Date.parse(typeof a.ts === "string" ? a.ts : new Date(0).toISOString()))
        .slice(0, 5)
        .map((entry) => buildEventAuditExcerpt(entry)),
    },
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

async function readRecentAuditEntries(workspaceDir: string): Promise<{
  filePath: string;
  fileExists: boolean;
  fileSizeBytes: number | null;
  fileMtime: string | null;
  entries: AuditEntry[];
}> {
  const filePath = join(workspaceDir, DATA_DIR, "log", "audit.log");
  try {
    const meta = await stat(filePath);
    const raw = await readFile(filePath, "utf-8");
    return {
      filePath,
      fileExists: true,
      fileSizeBytes: meta.size,
      fileMtime: Number.isFinite(meta.mtimeMs) ? new Date(meta.mtimeMs).toISOString() : null,
      entries: raw
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
        .filter((entry): entry is AuditEntry => entry !== null),
    };
  } catch {
    return {
      filePath,
      fileExists: false,
      fileSizeBytes: null,
      fileMtime: null,
      entries: [],
    };
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
      rawLoopBrakeReason: asString(entry.loopBrakeReason),
      rawTransitionReasonCategory: asString(entry.transitionReasonCategory),
      rawRefiningDecisionPath: asString(entry.refiningDecisionPath),
      rawHealthDecisionCategory: asString(entry.healthDecisionCategory),
      rawSourceBranch: asString(entry.sourceBranch),
      rawRepoPath: asString(entry.repoPath),
      rawPluginSourceRoot: asString(entry.pluginSourceRoot),
      rawBranchResolutionDecision: asString(entry.branchResolutionDecision),
      rawPrValidationDecision: asString(entry.prValidationDecision),
      rawPrValidationLookupOutcome: asString(entry.prValidationLookupOutcome),
      rawPrValidationBranchResolutionPreferredSource: asString(entry.prValidationBranchResolutionPreferredSource),
      rawPrValidationPreferredBranchConfidence: asString(entry.prValidationPreferredBranchConfidence),
      rawPrValidationBranchResolutionPreferredEvidence: asString(entry.prValidationBranchResolutionPreferredEvidence),
      rawPrValidationBranchSelectionWinnerSummary: asString(entry.prValidationBranchSelectionWinnerSummary),
      rawPrValidationBranchWinnerDecisionSummary: asString(entry.prValidationBranchWinnerDecisionSummary),
      rawPrValidationBranchWinnerComparedToLaneSummary: asString(entry.prValidationBranchWinnerComparedToLaneSummary),
      rawPrValidationLaneMismatchSummary: asString(entry.prValidationLaneMismatchSummary),
      rawPrValidationLaneMismatchCategory: asString(entry.prValidationLaneMismatchCategory),
      rawRepoSnapshot: isRecord(entry.repoSnapshot) ? entry.repoSnapshot : null,
      rawPluginSnapshot: isRecord(entry.pluginSnapshot) ? entry.pluginSnapshot : null,
      eventShapeSummary: `event=${event} stage=${asString(entry.stage) ?? "?"} issueField=${typeof entry.issueId === "number" ? "issueId" : typeof entry.issue === "number" ? "issue" : "none"} labels=${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"}`,
      compactDecisionSummary: `health_requeue ${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"} counted as ${rawReason ?? "orphan_requeue"}${asString(entry.orphanReason) ? ` (${asString(entry.orphanReason)})` : ""}`,
      rawHealthDecisionSummary: asString(entry.healthDecisionSummary),
      rawBranchWinnerSummary: asString(entry.branchSelectionWinnerSummary) ?? asString(entry.branchWinnerDecisionSummary),
      rawDuplicateSourceDecision: asString(entry.duplicateSourceDecision),
      rawPreferredBranchSource: asString(entry.branchResolutionPreferredSource) ?? asString(entry.preferredBranchSource),
      rawBranchResolutionPreferredEvidence: asString(entry.branchResolutionPreferredEvidence),
      rawPreferredBranchConfidence: asString(entry.preferredBranchConfidence),
      rawLaneMismatchSummary: asString(entry.laneMismatchSummary),
      rawLaneMismatchCategory: asString(entry.laneMismatchCategory),
      rawDuplicateSourceRisk: typeof entry.duplicateSourceRisk === "boolean" ? entry.duplicateSourceRisk : null,
      rawCanRequeueIssue: typeof entry.canRequeueIssue === "boolean" ? entry.canRequeueIssue : null,
      rawLiveSourceDecision: asString(entry.liveSourceDecision),
      rawLiveSourceSingularitySummary: asString(entry.liveSourceSingularitySummary),
      rawOpenclawConfigInstallSourcePath: asString(entry.openclawConfigInstallSourcePath),
      rawOpenclawConfigInstallSourceRealPath: asString(entry.openclawConfigInstallSourceRealPath),
      rawOpenclawConfigInstallPath: asString(entry.openclawConfigInstallPath),
      rawOpenclawConfigInstallPathRealPath: asString(entry.openclawConfigInstallPathRealPath),
      rawOpenclawConfigPluginLoadPaths: Array.isArray(entry.openclawConfigPluginLoadPaths) ? entry.openclawConfigPluginLoadPaths : null,
      rawOpenclawConfigPluginLoadPathRealPaths: Array.isArray(entry.openclawConfigPluginLoadPathRealPaths) ? entry.openclawConfigPluginLoadPathRealPaths : null,
      rawBranchResolutionMismatchFlags: isRecord(entry.branchResolutionMismatchFlags) ? entry.branchResolutionMismatchFlags : null,
      rawLiveSourceAgreementMatrix: isRecord(entry.liveSourceAgreementMatrix) ? entry.liveSourceAgreementMatrix : null,
      rawLaneIdentitySummary: isRecord(entry.laneIdentitySummary) ? entry.laneIdentitySummary : null,
      rawBranchSelectionDecisionTrace: isRecord(entry.branchSelectionDecisionTrace) ? entry.branchSelectionDecisionTrace : null,
      rawDuplicateSourceWinningRealPathGuess: asString(entry.duplicateSourceWinningRealPathGuess),
      rawDuplicateSourceCompetingRealPaths: Array.isArray(entry.duplicateSourceCompetingRealPaths) ? entry.duplicateSourceCompetingRealPaths : null,
      rawBranchSourceCandidateDecisionTable: Array.isArray(entry.branchSourceCandidateDecisionTable) ? entry.branchSourceCandidateDecisionTable : null,
      rawBranchSourceCandidateDiagnostics: Array.isArray(entry.branchSourceCandidateDiagnostics) ? entry.branchSourceCandidateDiagnostics : null,
      rawPrValidationDetectedBranch: asString(entry.prValidationDetectedBranch),
      rawPrValidationDetectedBranchSource: asString(entry.prValidationDetectedBranchSource),
      rawPrValidationDetectedBranchDecisionSummary: asString(entry.prValidationDetectedBranchDecisionSummary),
      rawPrValidationDetectedBranchMismatchReasons: Array.isArray(entry.prValidationDetectedBranchMismatchReasons) ? entry.prValidationDetectedBranchMismatchReasons : null,
      rawPrValidationBranchSourceCandidateDecisionTable: Array.isArray(entry.prValidationBranchSourceCandidateDecisionTable) ? entry.prValidationBranchSourceCandidateDecisionTable : null,
      rawPrValidationBranchSourceCandidateDiagnostics: Array.isArray(entry.prValidationBranchSourceCandidateDiagnostics) ? entry.prValidationBranchSourceCandidateDiagnostics : null,
      rawAuditExcerpt: buildEventAuditExcerpt(entry),
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
      rawLoopBrakeReason: asString(entry.loopBrakeReason),
      rawTransitionReasonCategory: asString(entry.transitionReasonCategory),
      rawRefiningDecisionPath: asString(entry.refiningDecisionPath),
      rawHealthDecisionCategory: asString(entry.healthDecisionCategory),
      rawSourceBranch: asString(entry.sourceBranch),
      rawRepoPath: asString(entry.repoPath),
      rawPluginSourceRoot: asString(entry.pluginSourceRoot),
      rawBranchResolutionDecision: asString(entry.branchResolutionDecision),
      rawPrValidationDecision: asString(entry.prValidationDecision),
      rawPrValidationLookupOutcome: asString(entry.prValidationLookupOutcome),
      rawPrValidationBranchResolutionPreferredSource: asString(entry.prValidationBranchResolutionPreferredSource),
      rawPrValidationPreferredBranchConfidence: asString(entry.prValidationPreferredBranchConfidence),
      rawPrValidationBranchResolutionPreferredEvidence: asString(entry.prValidationBranchResolutionPreferredEvidence),
      rawPrValidationBranchSelectionWinnerSummary: asString(entry.prValidationBranchSelectionWinnerSummary),
      rawPrValidationBranchWinnerDecisionSummary: asString(entry.prValidationBranchWinnerDecisionSummary),
      rawPrValidationBranchWinnerComparedToLaneSummary: asString(entry.prValidationBranchWinnerComparedToLaneSummary),
      rawPrValidationLaneMismatchSummary: asString(entry.prValidationLaneMismatchSummary),
      rawPrValidationLaneMismatchCategory: asString(entry.prValidationLaneMismatchCategory),
      rawRepoSnapshot: isRecord(entry.repoSnapshot) ? entry.repoSnapshot : null,
      rawPluginSnapshot: isRecord(entry.pluginSnapshot) ? entry.pluginSnapshot : null,
      eventShapeSummary: `event=${event} stage=${asString(entry.stage) ?? "?"} result=${asString(entry.result) ?? "?"} issueField=${typeof entry.issueId === "number" ? "issueId" : typeof entry.issue === "number" ? "issue" : "none"} labels=${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"}`,
      compactDecisionSummary: `work_finish ${asString(entry.result) ?? "?"} ${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"} counted as ${rawReason ?? "blocked"}`,
      rawHealthDecisionSummary: asString(entry.healthDecisionSummary),
      rawBranchWinnerSummary: asString(entry.branchSelectionWinnerSummary) ?? asString(entry.branchWinnerDecisionSummary),
      rawDuplicateSourceDecision: asString(entry.duplicateSourceDecision),
      rawPreferredBranchSource: asString(entry.branchResolutionPreferredSource) ?? asString(entry.preferredBranchSource),
      rawBranchResolutionPreferredEvidence: asString(entry.branchResolutionPreferredEvidence),
      rawPreferredBranchConfidence: asString(entry.preferredBranchConfidence),
      rawLaneMismatchSummary: asString(entry.laneMismatchSummary),
      rawLaneMismatchCategory: asString(entry.laneMismatchCategory),
      rawDuplicateSourceRisk: typeof entry.duplicateSourceRisk === "boolean" ? entry.duplicateSourceRisk : null,
      rawCanRequeueIssue: typeof entry.canRequeueIssue === "boolean" ? entry.canRequeueIssue : null,
      rawLiveSourceDecision: asString(entry.liveSourceDecision),
      rawLiveSourceSingularitySummary: asString(entry.liveSourceSingularitySummary),
      rawOpenclawConfigInstallSourcePath: asString(entry.openclawConfigInstallSourcePath),
      rawOpenclawConfigInstallSourceRealPath: asString(entry.openclawConfigInstallSourceRealPath),
      rawOpenclawConfigInstallPath: asString(entry.openclawConfigInstallPath),
      rawOpenclawConfigInstallPathRealPath: asString(entry.openclawConfigInstallPathRealPath),
      rawOpenclawConfigPluginLoadPaths: Array.isArray(entry.openclawConfigPluginLoadPaths) ? entry.openclawConfigPluginLoadPaths : null,
      rawOpenclawConfigPluginLoadPathRealPaths: Array.isArray(entry.openclawConfigPluginLoadPathRealPaths) ? entry.openclawConfigPluginLoadPathRealPaths : null,
      rawBranchResolutionMismatchFlags: isRecord(entry.branchResolutionMismatchFlags) ? entry.branchResolutionMismatchFlags : null,
      rawLiveSourceAgreementMatrix: isRecord(entry.liveSourceAgreementMatrix) ? entry.liveSourceAgreementMatrix : null,
      rawLaneIdentitySummary: isRecord(entry.laneIdentitySummary) ? entry.laneIdentitySummary : null,
      rawBranchSelectionDecisionTrace: isRecord(entry.branchSelectionDecisionTrace) ? entry.branchSelectionDecisionTrace : null,
      rawDuplicateSourceWinningRealPathGuess: asString(entry.duplicateSourceWinningRealPathGuess),
      rawDuplicateSourceCompetingRealPaths: Array.isArray(entry.duplicateSourceCompetingRealPaths) ? entry.duplicateSourceCompetingRealPaths : null,
      rawBranchSourceCandidateDecisionTable: Array.isArray(entry.branchSourceCandidateDecisionTable) ? entry.branchSourceCandidateDecisionTable : null,
      rawBranchSourceCandidateDiagnostics: Array.isArray(entry.branchSourceCandidateDiagnostics) ? entry.branchSourceCandidateDiagnostics : null,
      rawPrValidationDetectedBranch: asString(entry.prValidationDetectedBranch),
      rawPrValidationDetectedBranchSource: asString(entry.prValidationDetectedBranchSource),
      rawPrValidationDetectedBranchDecisionSummary: asString(entry.prValidationDetectedBranchDecisionSummary),
      rawPrValidationDetectedBranchMismatchReasons: Array.isArray(entry.prValidationDetectedBranchMismatchReasons) ? entry.prValidationDetectedBranchMismatchReasons : null,
      rawPrValidationBranchSourceCandidateDecisionTable: Array.isArray(entry.prValidationBranchSourceCandidateDecisionTable) ? entry.prValidationBranchSourceCandidateDecisionTable : null,
      rawPrValidationBranchSourceCandidateDiagnostics: Array.isArray(entry.prValidationBranchSourceCandidateDiagnostics) ? entry.prValidationBranchSourceCandidateDiagnostics : null,
      rawAuditExcerpt: buildEventAuditExcerpt(entry),
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
        rawLoopBrakeReason: asString(entry.loopBrakeReason),
        rawTransitionReasonCategory: asString(entry.transitionReasonCategory),
        rawRefiningDecisionPath: asString(entry.refiningDecisionPath),
        rawHealthDecisionCategory: asString(entry.healthDecisionCategory),
        rawSourceBranch: asString(entry.sourceBranch),
        rawRepoPath: asString(entry.repoPath),
        rawPluginSourceRoot: asString(entry.pluginSourceRoot),
        rawBranchResolutionDecision: asString(entry.branchResolutionDecision),
        rawPrValidationDecision: asString(entry.prValidationDecision),
        rawPrValidationLookupOutcome: asString(entry.prValidationLookupOutcome),
        rawPrValidationBranchResolutionPreferredSource: asString(entry.prValidationBranchResolutionPreferredSource),
        rawPrValidationPreferredBranchConfidence: asString(entry.prValidationPreferredBranchConfidence),
        rawPrValidationBranchResolutionPreferredEvidence: asString(entry.prValidationBranchResolutionPreferredEvidence),
        rawPrValidationBranchSelectionWinnerSummary: asString(entry.prValidationBranchSelectionWinnerSummary),
        rawPrValidationBranchWinnerDecisionSummary: asString(entry.prValidationBranchWinnerDecisionSummary),
        rawPrValidationBranchWinnerComparedToLaneSummary: asString(entry.prValidationBranchWinnerComparedToLaneSummary),
        rawPrValidationLaneMismatchSummary: asString(entry.prValidationLaneMismatchSummary),
        rawPrValidationLaneMismatchCategory: asString(entry.prValidationLaneMismatchCategory),
        rawRepoSnapshot: isRecord(entry.repoSnapshot) ? entry.repoSnapshot : null,
        rawPluginSnapshot: isRecord(entry.pluginSnapshot) ? entry.pluginSnapshot : null,
        eventShapeSummary: `event=${event} reason=${reason} issueField=${typeof entry.issueId === "number" ? "issueId" : typeof entry.issue === "number" ? "issue" : "none"} labels=${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"}`,
        compactDecisionSummary: `review_transition ${reason} ${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"} counted by loop brake`,
        rawHealthDecisionSummary: asString(entry.healthDecisionSummary),
        rawBranchWinnerSummary: asString(entry.branchSelectionWinnerSummary) ?? asString(entry.branchWinnerDecisionSummary),
        rawDuplicateSourceDecision: asString(entry.duplicateSourceDecision),
        rawPreferredBranchSource: asString(entry.branchResolutionPreferredSource) ?? asString(entry.preferredBranchSource),
        rawPreferredBranchConfidence: asString(entry.preferredBranchConfidence),
        rawLaneMismatchCategory: asString(entry.laneMismatchCategory),
        rawDuplicateSourceRisk: typeof entry.duplicateSourceRisk === "boolean" ? entry.duplicateSourceRisk : null,
        rawCanRequeueIssue: typeof entry.canRequeueIssue === "boolean" ? entry.canRequeueIssue : null,
        rawLiveSourceDecision: asString(entry.liveSourceDecision),
        rawLiveSourceSingularitySummary: asString(entry.liveSourceSingularitySummary),
        rawDuplicateSourceWinningRealPathGuess: asString(entry.duplicateSourceWinningRealPathGuess),
        rawDuplicateSourceCompetingRealPaths: Array.isArray(entry.duplicateSourceCompetingRealPaths) ? entry.duplicateSourceCompetingRealPaths : null,
        rawBranchSourceCandidateDecisionTable: Array.isArray(entry.branchSourceCandidateDecisionTable) ? entry.branchSourceCandidateDecisionTable : null,
        rawPrValidationDetectedBranch: asString(entry.prValidationDetectedBranch),
        rawPrValidationDetectedBranchSource: asString(entry.prValidationDetectedBranchSource),
        rawPrValidationDetectedBranchDecisionSummary: asString(entry.prValidationDetectedBranchDecisionSummary),
        rawPrValidationDetectedBranchMismatchReasons: Array.isArray(entry.prValidationDetectedBranchMismatchReasons) ? entry.prValidationDetectedBranchMismatchReasons : null,
        rawPrValidationBranchSourceCandidateDecisionTable: Array.isArray(entry.prValidationBranchSourceCandidateDecisionTable) ? entry.prValidationBranchSourceCandidateDecisionTable : null,
        rawAuditExcerpt: buildEventAuditExcerpt(entry),
      };
    }
  }

  return null;
}

function summarizeIssueEntry(entry: AuditEntry): string {
  return [
    typeof entry.event === "string" ? `event=${entry.event}` : null,
    asString(entry.stage) ? `stage=${asString(entry.stage)}` : null,
    asString(entry.result) ? `result=${asString(entry.result)}` : null,
    asString(entry.from) || asString(entry.to) ? `labels=${asString(entry.from) ?? "?"}->${asString(entry.to) ?? "?"}` : null,
    asString(entry.reason) ? `reason=${asString(entry.reason)}` : null,
    asString(entry.loopBrakeReason) ? `loopBrakeReason=${asString(entry.loopBrakeReason)}` : null,
    asString(entry.healthDecisionCategory) ? `healthDecisionCategory=${asString(entry.healthDecisionCategory)}` : null,
    asString(entry.transitionReasonCategory) ? `transitionReasonCategory=${asString(entry.transitionReasonCategory)}` : null,
  ].filter((value): value is string => Boolean(value)).join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
