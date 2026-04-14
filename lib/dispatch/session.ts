/**
 * session.ts — Session management helpers for dispatch.
 */
import type { RunCommand } from "../context.js";
import type { IssueProvider } from "../providers/provider.js";
import { log as auditLog } from "../audit.js";
import { fetchGatewaySessions } from "../services/gateway-sessions.js";
import { getDispatchStatus, upsertDispatchStatus } from "../services/dispatch-status.js";

// ---------------------------------------------------------------------------
// Context budget management
// ---------------------------------------------------------------------------

/**
 * Determine whether a session should be cleared based on context budget.
 *
 * Rules:
 * - If same issue (feedback cycle), keep session — worker needs prior context
 * - If context ratio exceeds sessionContextBudget, clear
 */
export async function shouldClearSession(
  sessionKey: string,
  slotIssueId: string | null,
  newIssueId: number,
  timeouts: import("../config/types.js").ResolvedTimeouts,
  workspaceDir: string,
  projectName: string,
  runCommand: RunCommand,
): Promise<boolean> {
  // Don't clear if re-dispatching for the same issue (feedback cycle)
  if (slotIssueId && String(newIssueId) === String(slotIssueId)) {
    return false;
  }

  // Check context budget via gateway session data
  try {
    const sessions = await fetchGatewaySessions(undefined, runCommand);
    if (!sessions) return false; // Gateway unavailable — don't clear

    const session = sessions.get(sessionKey);
    if (!session) return false; // Session not found — will be spawned fresh anyway

    const ratio = session.percentUsed / 100;
    if (ratio > timeouts.sessionContextBudget) {
      await auditLog(workspaceDir, "session_budget_reset", {
        project: projectName,
        sessionKey,
        reason: "context_budget",
        percentUsed: session.percentUsed,
        threshold: timeouts.sessionContextBudget * 100,
        totalTokens: session.totalTokens,
        contextTokens: session.contextTokens,
      });
      return true;
    }
  } catch {
    // Gateway query failed — don't clear, let dispatch proceed normally
  }

  return false;
}

// ---------------------------------------------------------------------------
// Private helpers — exist so dispatchTask reads as a sequence of steps
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget session creation/update.
 * Session key is deterministic, so we don't need to wait for confirmation.
 * If this fails, health check will catch orphaned state later.
 */
export function ensureSessionFireAndForget(
  sessionKey: string,
  model: string,
  workspaceDir: string,
  runCommand: RunCommand,
  opts: {
    timeoutMs?: number;
    label?: string;
    projectSlug: string;
    projectName: string;
    issueId: number;
    role: string;
    provider?: IssueProvider;
    postVisibleFailureMarker?: boolean;
    fromLabel?: string;
  },
): void {
  const rc = runCommand;
  const params: Record<string, unknown> = { key: sessionKey, model };
  if (opts.label) params.label = opts.label;
  upsertDispatchStatus(workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, {
    projectName: opts.projectName,
    sessionKey,
    sessionPatchStartedAt: new Date().toISOString(),
  }).catch(() => {});
  rc(
    ["openclaw", "gateway", "call", "sessions.patch", "--params", JSON.stringify(params)],
    { timeoutMs: opts.timeoutMs ?? 30_000 },
  ).then(() => {
    return upsertDispatchStatus(workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, {
      projectName: opts.projectName,
      sessionKey,
      sessionPatchSucceededAt: new Date().toISOString(),
      sessionPatchFailedAt: undefined,
      sessionPatchError: undefined,
    });
  }).catch(async (err) => {
    const error = (err as Error).message ?? String(err);
    upsertDispatchStatus(workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, {
      projectName: opts.projectName,
      sessionKey,
      sessionPatchFailedAt: new Date().toISOString(),
      sessionPatchError: error,
    }).catch(() => {});
    if (opts.provider && opts.postVisibleFailureMarker) {
      const status = await getDispatchStatus(workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role });
      if (!status?.failureCommentId) {
        opts.provider.addComment(opts.issueId, `⚠️ Research session preparation failed before the architect could respond.\n\n- Session: \`${sessionKey}\`\n- Error: \`${error}\`\n\nYou can retry by moving the issue back to \`${opts.fromLabel ?? "To Research"}\` and redispatching.`).then((commentId) => {
          upsertDispatchStatus(workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, { failureCommentId: commentId }).catch(() => {});
        }).catch(() => {});
      }
    }
    auditLog(workspaceDir, "dispatch_warning", {
      step: "ensureSession", sessionKey,
      error,
    }).catch(() => {});
  });
}

export function sendToAgent(
  sessionKey: string, taskMessage: string,
  opts: {
    agentId?: string;
    projectName: string;
    projectSlug: string;
    issueId: number;
    role: string;
    level?: string;
    slotIndex?: number;
    fromLabel?: string;
    orchestratorSessionKey?: string;
    workspaceDir: string;
    dispatchTimeoutMs?: number;
    extraSystemPrompt?: string;
    provider?: IssueProvider;
    postVisibleFailureMarker?: boolean;
    runCommand: RunCommand;
  },
): void {
  const rc = opts.runCommand;
  const gatewayParams = JSON.stringify({
    idempotencyKey: `devclaw-${opts.projectName}-${opts.issueId}-${opts.role}-${opts.level ?? "unknown"}-${opts.slotIndex ?? 0}-${opts.fromLabel ?? "unknown"}-${sessionKey}`,
    agentId: opts.agentId ?? "devclaw",
    sessionKey,
    message: taskMessage,
    deliver: false,
    lane: "subagent",
    ...(opts.orchestratorSessionKey ? { spawnedBy: opts.orchestratorSessionKey } : {}),
    ...(opts.extraSystemPrompt ? { extraSystemPrompt: opts.extraSystemPrompt } : {}),
  });
  upsertDispatchStatus(opts.workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, {
    projectName: opts.projectName,
    level: opts.level,
    sessionKey,
    agentDispatchStartedAt: new Date().toISOString(),
  }).catch(() => {});
  // Fire-and-forget: long-running agent turn, don't await
  rc(
    ["openclaw", "gateway", "call", "agent", "--params", gatewayParams, "--expect-final", "--json"],
    { timeoutMs: opts.dispatchTimeoutMs ?? 600_000 },
  ).then(() => {
    return upsertDispatchStatus(opts.workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, {
      projectName: opts.projectName,
      level: opts.level,
      sessionKey,
      agentDispatchAcceptedAt: new Date().toISOString(),
      agentDispatchFailedAt: undefined,
      agentDispatchError: undefined,
    });
  }).catch((err) => {
    const error = (err as Error).message ?? String(err);
    upsertDispatchStatus(opts.workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, {
      projectName: opts.projectName,
      level: opts.level,
      sessionKey,
      agentDispatchFailedAt: new Date().toISOString(),
      agentDispatchError: error,
    }).catch(() => {});
    if (opts.provider && opts.postVisibleFailureMarker) {
      getDispatchStatus(opts.workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }).then((status) => {
        if (status?.failureCommentId) return;
        opts.provider!.addComment(opts.issueId, `⚠️ Research dispatch failed before the architect could respond.\n\n- Session: \`${sessionKey}\`\n- Error: \`${error}\`\n\nYou can retry by moving the issue back to \`${opts.fromLabel ?? "To Research"}\` and redispatching.`).then((commentId) => {
          upsertDispatchStatus(opts.workspaceDir, { projectSlug: opts.projectSlug, issueId: opts.issueId, role: opts.role }, { failureCommentId: commentId }).catch(() => {});
        }).catch(() => {});
      }).catch(() => {});
    }
    auditLog(opts.workspaceDir, "dispatch_warning", {
      step: "sendToAgent", sessionKey,
      issue: opts.issueId, role: opts.role,
      error,
    }).catch(() => {});
  });
}
