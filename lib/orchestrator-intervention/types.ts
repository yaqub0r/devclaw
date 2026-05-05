import type { WorkflowConfig } from "../workflow/index.js";
import type { IssueProvider, Issue } from "../providers/provider.js";
import type { Project } from "../projects/index.js";

export const ORCHESTRATOR_INTERVENTION_EVENT_TYPES = [
  "worker.completed",
  "workflow.dispatch",
  "workflow.requeue",
  "workflow.hold",
  "review.feedback",
  "review.approved",
  "review.pr_closed",
  "pr.merged",
] as const;

export type OrchestratorInterventionEventType = typeof ORCHESTRATOR_INTERVENTION_EVENT_TYPES[number];

export type OrchestratorInterventionEvent = {
  ts: string;
  eventType: OrchestratorInterventionEventType;
  project: string;
  projectSlug: string;
  issueId: number;
  issueTitle?: string;
  issueUrl?: string;
  role?: string;
  level?: string;
  result?: string;
  reason?: string;
  fromState?: string;
  toState?: string;
  prUrl?: string | null;
  source: "worker" | "heartbeat" | "system";
  sessionKey?: string;
  data?: Record<string, unknown>;
};

export const ORCHESTRATOR_INTERVENTION_ACTION_TYPES = [
  "comment",
  "set_level",
  "requeue",
  "queue_issue",
  "create_followup",
] as const;

export type OrchestratorInterventionActionType = typeof ORCHESTRATOR_INTERVENTION_ACTION_TYPES[number];

export type OrchestratorInterventionAction = {
  type: OrchestratorInterventionActionType;
  message?: string;
  level?: string;
  issueId?: number;
  title?: string;
  body?: string;
  queueAfterCreate?: boolean;
};

export type OrchestratorInterventionPolicy = {
  id: string;
  title: string;
  enabled?: boolean;
  mode?: "notify" | "auto";
  issueId?: number;
  event: {
    type: OrchestratorInterventionEventType;
    role?: string;
    result?: string;
    reason?: string;
    fromState?: string;
    toState?: string;
  };
  action: OrchestratorInterventionAction;
  updatedAt: string;
  updatedBy?: string;
};

export type OrchestratorInterventionStore = {
  version: 1;
  updatedAt: string;
  policies: OrchestratorInterventionPolicy[];
};

export type OrchestratorInterventionExecution = {
  policyId: string;
  policyTitle: string;
  mode: "notify" | "auto";
  matched: boolean;
  executed: boolean;
  actionType: OrchestratorInterventionActionType;
  details?: Record<string, unknown>;
  error?: string;
};

export type InterventionRuntimeContext = {
  workspaceDir: string;
  channelId: string;
  messageThreadId?: number;
  project: Project;
  workflow: WorkflowConfig;
  provider: IssueProvider;
  issue: Issue;
  sessionKey?: string;
};
