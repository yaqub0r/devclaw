import { log as auditLog } from "../audit.js";
import { loadConfig } from "../config/index.js";
import { getRoleLabelColor, StateType, getCurrentStateLabel, findStateByLabel } from "../workflow/index.js";
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
    if (mode === "notify") {
      const details = { issueId: normalized.issueId, eventType: normalized.eventType };
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
      });
      continue;
    }

    try {
      const details = await executePolicyAction(ctx, normalized, policy.action);
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
  const planning = Object.values(workflow.states).find((state) => state.type === StateType.HOLD);
  if (!planning) throw new Error("workflow has no HOLD state to receive follow-up work");
  return planning.label;
}
