import { jsonResult } from "../../json-result.js";
import type { PluginContext } from "../../context.js";
import type { ToolContext } from "../../types.js";
import { log as auditLog } from "../../audit.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject } from "../helpers.js";
import { deleteInterventionPolicy, loadInterventionStore, upsertInterventionPolicy } from "../../orchestrator-intervention/store.js";
import { readInterventionEvents } from "../../orchestrator-intervention/timeline.js";
import {
  ORCHESTRATOR_INTERVENTION_ACTION_TYPES,
  ORCHESTRATOR_INTERVENTION_EVENT_TYPES,
  type OrchestratorInterventionPolicy,
} from "../../orchestrator-intervention/types.js";

export function createOrchestratorInterventionTool(ctx: PluginContext) {
  return (toolCtx: ToolContext) => ({
    name: "orchestrator_intervention",
    label: "Orchestrator Intervention",
    description: `Manage live orchestrator intervention policy and read the structured intervention event timeline.

Actions:
- set_policy: create or update a project-wide or issue-specific intervention rule
- delete_policy: remove a rule by id
- list_policies: list active rules for the project
- get_events: read normalized live workflow events for the project or one issue

Supported event types: ${ORCHESTRATOR_INTERVENTION_EVENT_TYPES.join(", ")}
Supported action types: ${ORCHESTRATOR_INTERVENTION_ACTION_TYPES.join(", ")}`,
    parameters: {
      type: "object",
      required: ["channelId", "action"],
      properties: {
        channelId: { type: "string", description: "YOUR chat/group ID — the numeric ID of the chat you are in right now." },
        messageThreadId: { type: "number", description: "Optional Telegram forum topic ID for this project." },
        action: {
          type: "string",
          enum: ["set_policy", "delete_policy", "list_policies", "get_events"],
          description: "Operation to perform.",
        },
        policyId: { type: "string", description: "Rule id for delete_policy, or explicit id for set_policy." },
        issueId: { type: "number", description: "Optional issue scope for set_policy or filter for get_events." },
        limit: { type: "number", description: "Max events to return for get_events. Defaults to 20." },
        policy: {
          type: "object",
          description: "Policy payload for set_policy.",
          properties: {
            title: { type: "string" },
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["notify", "auto"] },
            event: {
              type: "object",
              properties: {
                type: { type: "string", enum: [...ORCHESTRATOR_INTERVENTION_EVENT_TYPES] },
                role: { type: "string" },
                result: { type: "string" },
                reason: { type: "string" },
                fromState: { type: "string" },
                toState: { type: "string" },
              },
              required: ["type"],
            },
            action: {
              type: "object",
              properties: {
                type: { type: "string", enum: [...ORCHESTRATOR_INTERVENTION_ACTION_TYPES] },
                message: { type: "string" },
                level: { type: "string" },
                issueId: { type: "number" },
                title: { type: "string" },
                body: { type: "string" },
                queueAfterCreate: { type: "boolean" },
              },
              required: ["type"],
            },
          },
          required: ["title", "event", "action"],
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const action = params.action as "set_policy" | "delete_policy" | "list_policies" | "get_events";
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const messageThreadId = params.messageThreadId as number | undefined;
      const channelType = (toolCtx.messageChannel as string | undefined) ?? "telegram";
      const accountId = toolCtx.agentAccountId as string | undefined;
      const { project } = await resolveProject(workspaceDir, channelId, {
        channel: channelType,
        accountId,
        messageThreadId,
      });

      if (action === "list_policies") {
        const store = await loadInterventionStore(workspaceDir, project.slug);
        return jsonResult({ success: true, project: project.name, policies: store.policies });
      }

      if (action === "get_events") {
        const issueId = params.issueId as number | undefined;
        const limit = (params.limit as number | undefined) ?? 20;
        const events = await readInterventionEvents({ workspaceDir, projectSlug: project.slug, issueId, limit });
        return jsonResult({ success: true, project: project.name, issueId: issueId ?? null, events });
      }

      if (action === "delete_policy") {
        const policyId = params.policyId as string | undefined;
        if (!policyId) throw new Error("policyId is required for delete_policy");
        const deleted = await deleteInterventionPolicy(workspaceDir, project.slug, policyId);
        await auditLog(workspaceDir, "orchestrator_intervention_policy_delete", {
          project: project.name,
          policyId,
          deleted,
        });
        return jsonResult({ success: true, project: project.name, policyId, deleted });
      }

      const payload = params.policy as Record<string, unknown> | undefined;
      if (!payload) throw new Error("policy is required for set_policy");
      if (!payload.title || !payload.event || !payload.action) {
        throw new Error("policy.title, policy.event, and policy.action are required");
      }
      const policyId = (params.policyId as string | undefined) ?? slugify(String(payload.title));
      const issueId = params.issueId as number | undefined;
      const policy: Omit<OrchestratorInterventionPolicy, "updatedAt"> = {
        id: policyId,
        title: String(payload.title),
        enabled: payload.enabled as boolean | undefined,
        mode: (payload.mode as "notify" | "auto" | undefined) ?? "auto",
        issueId,
        event: payload.event as OrchestratorInterventionPolicy["event"],
        action: payload.action as OrchestratorInterventionPolicy["action"],
        updatedBy: toolCtx.sessionKey ?? toolCtx.agentId,
      };
      const saved = await upsertInterventionPolicy(workspaceDir, project.slug, policy);
      await auditLog(workspaceDir, "orchestrator_intervention_policy_set", {
        project: project.name,
        policyId: saved.id,
        title: saved.title,
        issueId: saved.issueId ?? null,
        mode: saved.mode,
        eventType: saved.event.type,
        actionType: saved.action.type,
      });
      return jsonResult({ success: true, project: project.name, policy: saved });
    },
  });
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "policy";
}
