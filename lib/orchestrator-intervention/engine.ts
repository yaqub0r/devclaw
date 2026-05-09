import { log as auditLog } from "../audit.js";
import { loadConfig } from "../config/index.js";
import { sendToSessionFireAndForget, type NotifyRoutingTarget } from "../dispatch/session.js";
import { getRoleLabelColor, StateType, getCurrentStateLabel, findStateByLabel, getInitialStateLabel } from "../workflow/index.js";
import type {
  InterventionRuntimeContext,
  OrchestratorInterventionAction,
  OrchestratorInterventionEvent,
  OrchestratorInterventionExecution,
  OrchestratorInterventionPolicy,
} from "./types.js";
import { appendInterventionEvent } from "./timeline.js";
import { loadInterventionStore } from "./store.js";
import { resolveTarget } from "../tools/tasks/task-start.js";

export async function recordAndApplyInterventionEvent(
  ctx: InterventionRuntimeContext,
  event: Omit<OrchestratorInterventionEvent, "ts" | "project" | "projectSlug" | "issueTitle" | "issueUrl" | "sessionKey">,
): Promise<OrchestratorInterventionExecution[]> {
  const normalized: OrchestratorInterventionEvent = {
    ts: new Date().toISOString(),
    project: ctx.project.name,
    projectSlug: ctx.project.slug,
    issueTitle: ctx.issue.title,
    issueUrl: ctx.issue.web_url,
    sessionKey: ctx.sessionKey,
    ...event,
  };

  await appendInterventionEvent(ctx.workspaceDir, normalized);

  const store = await loadInterventionStore(ctx.workspaceDir, ctx.project.slug);
  const executions: OrchestratorInterventionExecution[] = [];

  for (const policy of store.policies) {
    if (!matchesPolicy(policy, normalized)) continue;

    const mode = policy.mode ?? "auto";
    const wake = await wakeOrchestrator(ctx, normalized, policy, mode).catch((err) => ({
      delivered: false,
      error: (err as Error).message ?? String(err),
    }));

    if (mode === "notify") {
      const details = { issueId: normalized.issueId, eventType: normalized.eventType, wake };
      executions.push({
        policyId: policy.id,
        policyTitle: policy.title,
        matched: true,
        executed: false,
        mode,
        actionType: policy.action.type,
        details,
      });
      await auditLog(ctx.workspaceDir, "orchestrator_intervention_notify", {
        project: ctx.project.name,
        issueId: normalized.issueId,
        policyId: policy.id,
        policyTitle: policy.title,
        eventType: normalized.eventType,
        actionType: policy.action.type,
        wake,
      });
      continue;
    }

    try {
      const actionDetails = await executePolicyAction(ctx, normalized, policy.action);
      const details = { ...actionDetails, wake };
      const record = {
        policyId: policy.id,
        policyTitle: policy.title,
        matched: true,
        executed: true,
        mode,
        actionType: policy.action.type,
        details,
      } satisfies OrchestratorInterventionExecution;
      executions.push(record);
      await auditLog(ctx.workspaceDir, "orchestrator_intervention", {
        project: ctx.project.name,
        issueId: normalized.issueId,
        policyId: policy.id,
        policyTitle: policy.title,
        eventType: normalized.eventType,
        actionType: policy.action.type,
        details,
      });
    } catch (err) {
      const error = (err as Error).message ?? String(err);
      executions.push({
        policyId: policy.id,
        policyTitle: policy.title,
        matched: true,
        executed: false,
        mode,
        actionType: policy.action.type,
        error,
      });
      await auditLog(ctx.workspaceDir, "orchestrator_intervention_error", {
        project: ctx.project.name,
        issueId: normalized.issueId,
        policyId: policy.id,
        policyTitle: policy.title,
        eventType: normalized.eventType,
        actionType: policy.action.type,
        error,
        wake,
      });
    }
  }

  return executions;
}

function matchesPolicy(
  policy: OrchestratorInterventionPolicy,
  event: OrchestratorInterventionEvent,
): boolean {
  if (policy.enabled === false) return false;
  if (policy.issueId != null && policy.issueId !== event.issueId) return false;
  if (policy.event.type !== event.eventType) return false;
  if (policy.event.role && policy.event.role !== event.role) return false;
  if (policy.event.result && policy.event.result !== event.result) return false;
  if (policy.event.reason && policy.event.reason !== event.reason) return false;
  if (policy.event.fromState && policy.event.fromState !== event.fromState) return false;
  if (policy.event.toState && policy.event.toState !== event.toState) return false;
  return true;
}

async function executePolicyAction(
  ctx: InterventionRuntimeContext,
  event: OrchestratorInterventionEvent,
  action: OrchestratorInterventionAction,
): Promise<Record<string, unknown>> {
  switch (action.type) {
    case "comment": {
      const body = renderTemplate(action.message, event);
      if (!body.trim()) throw new Error("comment action requires message");
      const commentId = await ctx.provider.addComment(ctx.issue.iid, body);
      return { commentId, body };
    }

    case "set_level": {
      if (!action.level) throw new Error("set_level action requires level");
      const issue = await ctx.provider.getIssue(ctx.issue.iid);
      const currentLabel = getCurrentStateLabel(issue.labels, ctx.workflow);
      if (!currentLabel) throw new Error("issue has no recognized workflow label");
      const state = findStateByLabel(ctx.workflow, currentLabel);
      if (state?.type !== StateType.HOLD) {
        throw new Error(`set_level is only allowed from HOLD states, got ${currentLabel}`);
      }
      const target = resolveTarget(ctx.workflow, currentLabel, state);
      const targetRole = target.targetState.role;
      if (!targetRole) throw new Error("could not determine target role for set_level");
      const resolvedConfig = await loadConfig(ctx.workspaceDir, ctx.project.name);
      const roleConfig = resolvedConfig.roles[targetRole];
      if (!roleConfig.levels.includes(action.level)) {
        throw new Error(`invalid level ${action.level} for role ${targetRole}`);
      }
      const oldRoleLabels = issue.labels.filter((label) => label.startsWith(`${targetRole}:`));
      if (oldRoleLabels.length > 0) await ctx.provider.removeLabels(issue.iid, oldRoleLabels);
      const newRoleLabel = `${targetRole}:${action.level}`;
      await ctx.provider.ensureLabel(newRoleLabel, getRoleLabelColor(targetRole));
      await ctx.provider.addLabel(issue.iid, newRoleLabel);
      return { targetRole, level: action.level };
    }

    case "requeue": {
      const issue = await ctx.provider.getIssue(ctx.issue.iid);
      const currentLabel = getCurrentStateLabel(issue.labels, ctx.workflow);
      if (!currentLabel) throw new Error("issue has no recognized workflow label");
      const currentState = findStateByLabel(ctx.workflow, currentLabel);
      if (!currentState) throw new Error(`unknown state for ${currentLabel}`);
      const target = resolveTarget(ctx.workflow, currentLabel, currentState);
      if (target.transitioned) {
        await ctx.provider.transitionLabel(issue.iid, currentLabel, target.targetLabel);
      }
      const message = renderTemplate(action.message, event);
      let commentId: number | undefined;
      if (message.trim()) {
        commentId = await ctx.provider.addComment(issue.iid, message);
      }
      return { from: currentLabel, to: target.targetLabel, transitioned: target.transitioned, commentId };
    }

    case "queue_issue": {
      const targetIssueId = action.issueId;
      if (targetIssueId == null) throw new Error("queue_issue action requires issueId");
      const issue = await ctx.provider.getIssue(targetIssueId);
      const currentLabel = getCurrentStateLabel(issue.labels, ctx.workflow);
      if (!currentLabel) throw new Error(`issue #${targetIssueId} has no recognized workflow label`);
      const currentState = findStateByLabel(ctx.workflow, currentLabel);
      if (!currentState) throw new Error(`unknown state for ${currentLabel}`);
      const target = resolveTarget(ctx.workflow, currentLabel, currentState);
      if (target.transitioned) {
        await ctx.provider.transitionLabel(targetIssueId, currentLabel, target.targetLabel);
      }
      return { targetIssueId, from: currentLabel, to: target.targetLabel, transitioned: target.transitioned };
    }

    case "create_followup": {
      const planningLabel = findPlanningLabel(ctx.workflow);
      const title = renderTemplate(action.title, event);
      if (!title.trim()) throw new Error("create_followup action requires title");
      const body = renderTemplate(action.body, event);
      const created = await ctx.provider.createIssue(title, body, planningLabel);
      if (action.queueAfterCreate) {
        const createdState = findStateByLabel(ctx.workflow, planningLabel);
        if (createdState) {
          const target = resolveTarget(ctx.workflow, planningLabel, createdState);
          if (target.transitioned) {
            await ctx.provider.transitionLabel(created.iid, planningLabel, target.targetLabel);
          }
          return { createdIssueId: created.iid, createdIssueUrl: created.web_url, queuedTo: target.targetLabel };
        }
      }
      return { createdIssueId: created.iid, createdIssueUrl: created.web_url, createdLabel: planningLabel };
    }
  }
}

function renderTemplate(template: string | undefined, event: OrchestratorInterventionEvent): string {
  const raw = template ?? "";
  const values: Record<string, string> = {
    project: event.project,
    issueId: String(event.issueId),
    issueTitle: event.issueTitle ?? "",
    issueUrl: event.issueUrl ?? "",
    role: event.role ?? "",
    level: event.level ?? "",
    result: event.result ?? "",
    reason: event.reason ?? "",
    fromState: event.fromState ?? "",
    toState: event.toState ?? "",
    prUrl: event.prUrl ?? "",
    eventType: event.eventType,
    summary: String(event.data?.summary ?? ""),
  };
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => values[key] ?? "");
}

function findPlanningLabel(workflow: InterventionRuntimeContext["workflow"]): string {
  const planningLabel = getInitialStateLabel(workflow);
  const planning = findStateByLabel(workflow, planningLabel);
  if (!planning || !isHoldState(planning.type)) {
    throw new Error(`workflow initial state ${planningLabel} is not a HOLD state`);
  }
  return planningLabel;
}

function isHoldState(type: string | undefined): boolean {
  return (type ?? "").toLowerCase() === StateType.HOLD;
}

async function wakeOrchestrator(
  ctx: InterventionRuntimeContext,
  event: OrchestratorInterventionEvent,
  policy: OrchestratorInterventionPolicy,
  mode: "notify" | "auto",
): Promise<Record<string, unknown>> {
  if (!ctx.runCommand) return { delivered: false, reason: "runCommand_unavailable" };

  const notifyTarget = resolveWakeTarget(ctx);
  if (!notifyTarget) return { delivered: false, reason: "channel_unavailable" };

  const agentId = ctx.agentId ?? "main";
  const sessionKey = buildMainOrchestratorSessionKey(agentId, notifyTarget);
  sendToSessionFireAndForget(sessionKey, buildWakeMessage(event, policy, mode), {
    agentId,
    workspaceDir: ctx.workspaceDir,
    runCommand: ctx.runCommand,
    lane: "main",
    notifyTarget,
    idempotencyKey: `devclaw-orchestrator-wake-${ctx.project.slug}-${policy.id}-${event.issueId}-${event.eventType}-${event.ts}`,
  });

  await auditLog(ctx.workspaceDir, "orchestrator_intervention_wake", {
    project: ctx.project.name,
    issueId: event.issueId,
    policyId: policy.id,
    eventType: event.eventType,
    mode,
    sessionKey,
  });

  return { delivered: true, sessionKey, channelId: notifyTarget.channelId, messageThreadId: notifyTarget.messageThreadId ?? null };
}

function resolveWakeTarget(ctx: InterventionRuntimeContext): NotifyRoutingTarget | null {
  const channel = ctx.project.channels.find((entry) =>
    entry.channelId === ctx.channelId && (ctx.messageThreadId == null || entry.messageThreadId === ctx.messageThreadId),
  ) ?? ctx.project.channels[0];
  if (!channel) return null;
  return {
    channelId: channel.channelId,
    channel: channel.channel,
    accountId: channel.accountId,
    messageThreadId: channel.messageThreadId,
  };
}

function buildMainOrchestratorSessionKey(agentId: string, target: NotifyRoutingTarget): string {
  const base = `agent:${agentId}:${target.channel}:group:${target.channelId}`;
  return target.messageThreadId != null ? `${base}:topic:${target.messageThreadId}` : base;
}

function buildWakeMessage(
  event: OrchestratorInterventionEvent,
  policy: OrchestratorInterventionPolicy,
  mode: "notify" | "auto",
): string {
  return [
    `Live intervention wake for issue #${event.issueId}.`,
    "",
    `Matched policy: ${policy.title} (${policy.id})`,
    `Mode: ${mode}`,
    `Event: ${event.eventType}`,
    `Action: ${policy.action.type}`,
    "",
    "Structured event:",
    "```json",
    JSON.stringify(event, null, 2),
    "```",
    "",
    mode === "auto"
      ? "DevClaw is executing the bounded action automatically. Review and intervene if you want to add guidance or override with further policy."
      : "Please review this event and decide whether to intervene. The matched policy is notify-only, so no automatic workflow action was taken.",
  ].join("\n");
}
