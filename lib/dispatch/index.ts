/**
 * dispatch/index.ts — Core dispatch logic used by projectTick (heartbeat).
 *
 * Handles: session lookup, plugin-owned subagent spawn/reuse (with a legacy
 * Gateway CLI fallback), state update (activateWorker), and audit logging.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { RunCommand } from "../context.js";
import { log as auditLog } from "../audit.js";
import { recordLoopDiagnostic } from "../services/loop-diagnostics.js";
import {
  type Project,
  activateWorker,
  updateSlot,
  getRoleWorker,
  emptySlot,
} from "../projects/index.js";
import { resolveModel } from "../roles/index.js";
import { notify, getNotificationConfig } from "./notify.js";
import { loadConfig, type ResolvedRoleConfig } from "../config/index.js";
import { ReviewPolicy, TestPolicy, resolveReviewRouting, resolveTestRouting, resolveNotifyChannel, isFeedbackState, hasReviewCheck, producesReviewableWork, hasTestPhase, detectOwner, getOwnerLabel, OWNER_LABEL_COLOR, getRoleLabelColor, STEP_ROUTING_COLOR, getStateLabels } from "../workflow/index.js";
import { fetchPrFeedback, fetchPrContext, type PrFeedback, type PrContext } from "./pr-context.js";
import { formatAttachmentsForTask } from "./attachments.js";
import { loadRoleInstructions } from "./bootstrap-hook.js";
import { slotName } from "../names.js";

import { buildTaskMessage, buildConflictFixMessage, buildAnnouncement, formatSessionLabel } from "./message-builder.js";
import {
  buildMainOrchestratorSessionKey,
  sendToAgent,
  shouldClearSession,
} from "./session.js";
import { acknowledgeComments, EYES_EMOJI } from "./acknowledge.js";
import { recordAndApplyInterventionEvent } from "../orchestrator-intervention/engine.js";

export type DispatchOpts = {
  workspaceDir: string;
  agentId?: string;
  project: Project;
  issueId: number;
  issueTitle: string;
  issueDescription: string;
  issueUrl: string;
  role: string;
  /** Developer level (junior, mid, senior) or raw model ID */
  level: string;
  /** Label to transition FROM (e.g. "To Do", "To Test", "To Improve") */
  fromLabel: string;
  /** Label to transition TO (e.g. "Doing", "Testing") */
  toLabel: string;
  /** Issue provider for issue operations and label transitions */
  provider: import("../providers/provider.js").IssueProvider;
  /** Plugin config for model resolution and notification config */
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
  /** Calling orchestrator session. Persisted as child lineage on OpenClaw 2026.7+. */
  parentSessionKey?: string;
  /** Slot index within the role's worker slots (defaults to 0 for single-worker compat) */
  slotIndex?: number;
  /** Instance name for ownership labels (auto-claimed on dispatch if not already owned) */
  instanceName?: string;
  /** Injected runCommand for dependency injection. */
  runCommand: RunCommand;
};

export type DispatchResult = {
  sessionAction: "spawn" | "send";
  sessionKey: string;
  runId?: string;
  level: string;
  model: string;
  announcement: string;
};

/**
 * Dispatch a task to a worker session.
 *
 * Flow:
 *   1. Resolve model, session key, build task message (setup — no side effects)
 *   2. Transition label (commitment point — issue leaves queue)
 *   3. Await native subagent launch acceptance (rollback label on rejection)
 *   4. Update worker state
 *   5. Apply labels, send notification
 *   6. Audit
 *
 * If setup fails, the issue stays in its queue untouched.
 * If launch is rejected, the issue returns to its queue and the slot stays inactive.
 * On state update failure after dispatch: logs warning (session IS running).
 */
export async function dispatchTask(
  opts: DispatchOpts,
): Promise<DispatchResult> {
  const {
    workspaceDir, agentId, project, issueId, issueTitle,
    issueDescription, issueUrl, role, level, fromLabel, toLabel,
    provider, pluginConfig, runtime,
  } = opts;

  const slotIndex = opts.slotIndex ?? 0;
  const rc = opts.runCommand;

  // ── Setup (no side effects — safe to fail) ──────────────────────────
  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const resolvedRole = resolvedConfig.roles[role];
  const { timeouts, workflow } = resolvedConfig;
  const model = resolveModel(role, level, resolvedRole);
  const roleWorker = getRoleWorker(project, role);
  const slot = roleWorker.levels[level]?.[slotIndex] ?? emptySlot();
  let existingSessionKey = slot.sessionKey;

  // Deactivated slot: preserve session if same issue is returning (feedback cycle)
  if (existingSessionKey && !slot.issueId) {
    const isSameIssueReturn = slot.lastIssueId && String(issueId) === String(slot.lastIssueId);
    if (!isSameIssueReturn) {
      await rc(
        ["openclaw", "gateway", "call", "sessions.delete", "--params", JSON.stringify({ key: existingSessionKey })],
        { timeoutMs: 10_000 },
      ).catch(() => {});
      existingSessionKey = null;
    }
  }

  // Context budget check: clear session if over budget (unless same issue — feedback cycle)
  if (existingSessionKey && timeouts.sessionContextBudget < 1) {
    const shouldClear = await shouldClearSession(existingSessionKey, slot.issueId, issueId, timeouts, workspaceDir, project.name, rc);
    if (shouldClear) {
      // Delete the gateway session (await to prevent a race with the next launch).
      await rc(
        ["openclaw", "gateway", "call", "sessions.delete", "--params", JSON.stringify({ key: existingSessionKey })],
        { timeoutMs: 10_000 },
      ).catch(() => {});
      await updateSlot(workspaceDir, project.slug, role, level, slotIndex, {
        sessionKey: null,
      });
      existingSessionKey = null;
    }
  }

  // Compute session key deterministically (avoids waiting for gateway)
  // Slot name provides both collision prevention and human-readable identity
  const botName = slotName(project.name, role, level, slotIndex);
  // Use project.slug (always lowercase) to build session key.
  // project.name may have mixed case (e.g. "UpMoltWork"), which caused heartbeat
  // mismatches when the gateway stores session keys in lowercase format.
  const projectKey = (project.slug ?? project.name).toLowerCase();
  const sessionKey = `agent:${agentId ?? "unknown"}:subagent:${projectKey}-${role}-${level}-${botName.toLowerCase()}`;

  // Clear stale session key if it doesn't match the current deterministic key
  // (handles migration from old numeric format like ...-0 to name-based ...-Cordelia)
  if (existingSessionKey && existingSessionKey !== sessionKey) {
    // Delete the orphaned gateway session (await to prevent a race with the next launch).
    await rc(
      ["openclaw", "gateway", "call", "sessions.delete", "--params", JSON.stringify({ key: existingSessionKey })],
      { timeoutMs: 10_000 },
    ).catch(() => {});
    existingSessionKey = null;
  }

  const sessionAction = existingSessionKey ? "send" : "spawn";

  // Resolve the issue-specific endpoint before constructing the task. The
  // native subagent runtime does not accept channel/topic delivery fields, so
  // this routing contract must travel in the worker message itself.
  let issue: { labels: string[] } | undefined;
  try {
    issue = await provider.getIssue(issueId);
  } catch {
    // Fall back to the project's primary endpoint.
  }
  const notifyTarget = resolveNotifyChannel(issue?.labels ?? [], project.channels) ?? {
    channelId: project.slug,
    channel: "telegram",
  };
  const parentSessionKey = opts.parentSessionKey?.trim() ||
    buildMainOrchestratorSessionKey(agentId ?? "main", notifyTarget);

  // Fetch comments to include in task context
  const comments = await provider.listComments(issueId);

  // Fetch PR context based on workflow role semantics (no hardcoded role/label checks)
  const prFeedback = isFeedbackState(workflow, fromLabel)
    ? await fetchPrFeedback(provider, issueId) : undefined;
  const prContext = hasReviewCheck(workflow, role)
    ? await fetchPrContext(provider, issueId) : undefined;

  // Fetch attachment context (best-effort — never blocks dispatch)
  let attachmentContext: string | undefined;
  try {
    attachmentContext = await formatAttachmentsForTask(workspaceDir, project.slug, issueId) || undefined;
  } catch { /* best-effort */ }

  const primaryChannelId = notifyTarget.channelId;
  const isConflictFix = prFeedback?.reason === "merge_conflict";
  const taskMessage = isConflictFix && prFeedback
    ? buildConflictFixMessage({
        projectName: project.name, routing: notifyTarget, role, issueId,
        issueTitle, issueUrl,
        repo: project.repo, baseBranch: project.baseBranch,
        resolvedRole, prFeedback,
      })
    : buildTaskMessage({
        projectName: project.name, routing: notifyTarget, role, issueId,
        issueTitle, issueDescription, issueUrl,
        repo: project.repo, baseBranch: project.baseBranch,
        comments, resolvedRole, prContext, prFeedback, attachmentContext,
      });

  // Load role-specific instructions to inject into the worker's system prompt
  const roleInstructions = await loadRoleInstructions(workspaceDir, project.name, role);

  // ── Commitment point — transition label (issue leaves queue) ────────
  await provider.transitionLabel(issueId, fromLabel, toLabel);
  await recordLoopDiagnostic(workspaceDir, "dispatch_pickup", {
    project: project.name,
    issueId,
    role,
    level,
    from: fromLabel,
    to: toLabel,
    sessionAction,
    sessionKey,
  }).catch(() => {});

  const sessionLabel = formatSessionLabel(project.name, role, level, botName);

  // OpenClaw 2026.7+ resolves this promise after accepting the plugin-owned
  // subagent run. Rejection returns the issue to its queue before any slot is
  // marked active or worker-start notification is emitted.
  let runId: string | undefined;
  try {
    const acceptance = await sendToAgent(sessionKey, taskMessage, {
      agentId, projectName: project.name, issueId, role, level, slotIndex, fromLabel,
      workspaceDir,
      model,
      sessionLabel,
      sessionPatchTimeoutMs: timeouts.sessionPatchMs,
      dispatchTimeoutMs: timeouts.dispatchMs,
      extraSystemPrompt: roleInstructions.trim() || undefined,
      runCommand: rc,
      runtime,
      parentSessionKey,
      notifyTarget,
    });
    runId = acceptance.runId;
  } catch (err) {
    let rollbackError: unknown;
    try {
      await provider.transitionLabel(issueId, toLabel, fromLabel);
    } catch (rollbackErr) {
      rollbackError = rollbackErr;
    }
    await auditLog(workspaceDir, "dispatch_rejected", {
      project: project.name,
      issue: issueId,
      role,
      level,
      sessionKey,
      error: (err as Error).message ?? String(err),
      rollbackError: rollbackError
        ? ((rollbackError as Error).message ?? String(rollbackError))
        : undefined,
    }).catch(() => {});
    if (rollbackError) {
      throw new Error(
        `Worker launch was rejected and queue rollback failed: ${(err as Error).message ?? String(err)}; rollback: ${(rollbackError as Error).message ?? String(rollbackError)}`,
      );
    }
    throw err;
  }

  // Persist the accepted worker before secondary labels and notifications.
  try {
    await recordWorkerState(workspaceDir, project.slug, role, slotIndex, {
      issueId, level, sessionKey, sessionAction, fromLabel, name: botName,
    });
  } catch (err) {
    // Session is already dispatched — log warning but don't fail.
    await auditLog(workspaceDir, "dispatch", {
      project: project.name, issue: issueId, role,
      warning: "State update failed after successful dispatch",
      error: (err as Error).message, sessionKey, runId,
    });
  }

  // Mark issue + PR as managed and all consumed comments as seen (fire-and-forget)
  provider.reactToIssue(issueId, EYES_EMOJI).catch(() => {});
  provider.reactToPr(issueId, EYES_EMOJI).catch(() => {});
  acknowledgeComments(provider, issueId, comments, prFeedback, workspaceDir).catch((err) => {
    auditLog(workspaceDir, "dispatch_warning", {
      step: "acknowledgeComments",
      issue: issueId,
      error: (err as Error).message ?? String(err),
    }).catch(() => {});
  });

  // Apply role:level label (best-effort — failure must not abort dispatch)
  // IMPORTANT: Never pass state labels to removeLabels() — state transitions are
  // handled exclusively by transitionLabel(). Accidentally removing a state label
  // makes the issue invisible to the queue scanner. See #473 for context.
  try {
    const stateLabels = getStateLabels(workflow);

    const oldRoleLabels = issue?.labels.filter((l) => l.startsWith(`${role}:`)) ?? [];
    const safeRoleLabels = filterNonStateLabels(oldRoleLabels, stateLabels);
    if (safeRoleLabels.length > 0) {
      await provider.removeLabels(issueId, safeRoleLabels);
    }
    const roleLabel = `${role}:${level}:${botName}`;
    await provider.ensureLabel(roleLabel, getRoleLabelColor(role));
    await provider.addLabel(issueId, roleLabel);

    if (producesReviewableWork(workflow, role)) {
      const reviewLabel = resolveReviewRouting(
        workflow.reviewPolicy ?? ReviewPolicy.HUMAN, level,
      );
      const oldRouting = issue?.labels.filter((l) => l.startsWith("review:")) ?? [];
      const safeRouting = filterNonStateLabels(oldRouting, stateLabels);
      if (safeRouting.length > 0) await provider.removeLabels(issueId, safeRouting);
      await provider.ensureLabel(reviewLabel, STEP_ROUTING_COLOR);
      await provider.addLabel(issueId, reviewLabel);
    }

    if (hasTestPhase(workflow)) {
      const testLabel = resolveTestRouting(
        workflow.testPolicy ?? TestPolicy.SKIP, level,
      );
      const oldTestRouting = issue?.labels.filter((l) => l.startsWith("test:")) ?? [];
      const safeTestRouting = filterNonStateLabels(oldTestRouting, stateLabels);
      if (safeTestRouting.length > 0) await provider.removeLabels(issueId, safeTestRouting);
      await provider.ensureLabel(testLabel, STEP_ROUTING_COLOR);
      await provider.addLabel(issueId, testLabel);
    }

    if (opts.instanceName && !detectOwner(issue?.labels ?? [])) {
      const ownerLabel = getOwnerLabel(opts.instanceName);
      await provider.ensureLabel(ownerLabel, OWNER_LABEL_COLOR);
      await provider.addLabel(issueId, ownerLabel);
    }
  } catch {
    // Best-effort — label failure must not abort dispatch
  }

  // Notify only after OpenClaw accepts the worker run.
  const notifyConfig = getNotificationConfig(pluginConfig);
  notify(
    {
      type: "workerStart",
      project: project.name,
      issueId,
      issueTitle,
      issueUrl,
      role,
      level,
      name: botName,
      sessionAction,
    },
    {
      workspaceDir,
      config: notifyConfig,
      channelId: notifyTarget?.channelId,
      channel: notifyTarget?.channel ?? "telegram",
      runtime,
      accountId: notifyTarget?.accountId,
      messageThreadId: notifyTarget?.messageThreadId,
      runCommand: rc,
    },
  ).catch((err) => {
    auditLog(workspaceDir, "dispatch_warning", {
      step: "notify", issue: issueId, role,
      error: (err as Error).message ?? String(err),
    }).catch(() => {});
  });

  // Step 6: Audit
  await recordAndApplyInterventionEvent({
    workspaceDir,
    channelId: primaryChannelId,
    agentId,
    project,
    workflow,
    provider,
    issue: await provider.getIssue(issueId),
    sessionKey,
    runCommand: rc,
  }, {
    eventType: "workflow.dispatch",
    issueId,
    role,
    level,
    fromState: fromLabel,
    toState: toLabel,
    source: "system",
    data: { sessionAction, botName, runId },
  }).catch(() => {});

  await auditDispatch(workspaceDir, {
    project: project.name, issueId, issueTitle,
    role, level, model, sessionAction, sessionKey,
    fromLabel, toLabel,
  });

  const announcement = buildAnnouncement(level, role, sessionAction, issueId, issueTitle, issueUrl, resolvedRole, botName);

  return { sessionAction, sessionKey, runId, level, model, announcement };
}

async function recordWorkerState(
  workspaceDir: string, slug: string, role: string, slotIndex: number,
  opts: { issueId: number; level: string; sessionKey: string; sessionAction: "spawn" | "send"; fromLabel?: string; name?: string },
): Promise<void> {
  await activateWorker(workspaceDir, slug, role, {
    issueId: String(opts.issueId),
    level: opts.level,
    sessionKey: opts.sessionKey,
    startTime: new Date().toISOString(),
    previousLabel: opts.fromLabel,
    slotIndex,
    name: opts.name,
  });
}

/**
 * Filter out state labels from a label array to prevent accidental state loss.
 * State labels should only be modified via transitionLabel(). See #473.
 */
function filterNonStateLabels(labels: string[], stateLabels: string[]): string[] {
  return labels.filter((l) => !stateLabels.includes(l));
}

async function auditDispatch(
  workspaceDir: string,
  opts: {
    project: string; issueId: number; issueTitle: string;
    role: string; level: string; model: string; sessionAction: string;
    sessionKey: string; fromLabel: string; toLabel: string;
  },
): Promise<void> {
  await auditLog(workspaceDir, "dispatch", {
    project: opts.project,
    issue: opts.issueId, issueTitle: opts.issueTitle,
    role: opts.role, level: opts.level,
    sessionAction: opts.sessionAction, sessionKey: opts.sessionKey,
    labelTransition: `${opts.fromLabel} → ${opts.toLabel}`,
  });
  await auditLog(workspaceDir, "model_selection", {
    issue: opts.issueId, role: opts.role, level: opts.level, model: opts.model,
  });
}

