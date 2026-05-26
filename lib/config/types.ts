/**
 * config/types.ts — Types for the unified DevClaw configuration.
 *
 * A single workflow.yaml combines roles, models, and workflow.
 * Three-layer resolution: built-in → workspace → per-project.
 */
import type { WorkflowConfig } from "../workflow/index.js";

export type DeploymentAction = "deploy" | "promote" | "accept" | "rollback";
export type CandidateSource = "explicit" | "issueCandidate" | "issuePr" | "gitHead";
export type IssueLinkageMode = "none" | "comment" | "workflow";

export type DeploymentLaneConfig = {
  aliases?: string[];
  description?: string;
  humanOnly?: boolean;
  protected?: boolean;
  rollbackTargets?: string[];
  legacyBranch?: string;
  legacyUrl?: string;
};

export type DeploymentCommandConfig = {
  run: string;
  cwd?: string;
  timeoutMs?: number;
};

export type DeploymentEvidenceProfile = {
  required?: string[];
  commentSummary?: boolean;
};

export type DeploymentTransitionConfig = {
  action: DeploymentAction;
  from?: string;
  to: string;
  command: string;
  evidence?: string;
  requireCandidate?: boolean;
};

export type DeploymentWorkflowStateConfig = {
  action: DeploymentAction;
  targetLane: string;
  sourceLane?: string;
  issueLinkage?: IssueLinkageMode;
};

export type DeploymentConfig = {
  lanes?: Record<string, DeploymentLaneConfig>;
  commands?: Record<string, DeploymentCommandConfig>;
  evidenceProfiles?: Record<string, DeploymentEvidenceProfile>;
  transitions?: DeploymentTransitionConfig[];
  workflow?: {
    states?: Record<string, DeploymentWorkflowStateConfig>;
  };
  candidate?: {
    sources?: CandidateSource[];
  };
  policy?: {
    allowDirectWithoutIssue?: boolean;
    requireHumanForProtectedLanes?: boolean;
  };
};

/**
 * Role override in workflow.yaml. All fields optional — only override what you need.
 * Set to `false` to disable a role entirely for a project.
 */
/** Model entry: plain string or object with per-level maxWorkers override. */
export type ModelEntry = string | { model: string; maxWorkers?: number };

export type RoleOverride = {
  maxWorkers?: number; // @deprecated — kept for backward compat, ignored by resolver
  levels?: string[];
  defaultLevel?: string;
  models?: Record<string, ModelEntry>;
  emoji?: Record<string, string>;
  completionResults?: string[];
};

/**
 * Configurable timeout values (in milliseconds).
 * All fields optional — defaults applied at resolution time.
 */
export type TimeoutConfig = {
  gitPullMs?: number;
  gatewayMs?: number;
  sessionPatchMs?: number;
  dispatchMs?: number;
  staleWorkerHours?: number;
  /** Context budget ratio (0-1). Clear session when context exceeds this fraction of the context window. Default: 0.6 */
  sessionContextBudget?: number;
  /** Minutes of session inactivity before stall detection kicks in. Default: 15 */
  stallTimeoutMinutes?: number;
};

/**
 * Instance identity config. Optional — auto-generated if not set.
 */
export type InstanceConfig = {
  /** Override the auto-generated instance name (CS pioneer name). */
  name?: string;
};

/**
 * The full workflow.yaml shape.
 * All fields optional — missing fields inherit from the layer below.
 */
export type DevClawConfig = {
  roles?: Record<string, RoleOverride | false>;
  workflow?: Partial<WorkflowConfig>;
  deployment?: DeploymentConfig;
  timeouts?: TimeoutConfig;
  instance?: InstanceConfig;
};

/**
 * Fully resolved timeout config — all fields present with defaults.
 */
export type ResolvedTimeouts = {
  gitPullMs: number;
  gatewayMs: number;
  sessionPatchMs: number;
  dispatchMs: number;
  staleWorkerHours: number;
  /** Context budget ratio (0-1). Clear session when context exceeds this fraction of the context window. Default: 0.6 */
  sessionContextBudget: number;
  /** Minutes of session inactivity before stall detection kicks in. Default: 15 */
  stallTimeoutMinutes: number;
};

/**
 * Fully resolved config — all fields guaranteed present.
 * Built by merging three layers over the built-in defaults.
 */
export type ResolvedConfig = {
  roles: Record<string, ResolvedRoleConfig>;
  workflow: WorkflowConfig;
  deployment: DeploymentConfig;
  timeouts: ResolvedTimeouts;
  /** Instance name override from config. Undefined = use auto-generated from instance.json. */
  instanceName?: string;
};

/**
 * Fully resolved role config — all fields present.
 */
export type ResolvedRoleConfig = {
  /** Per-level max workers. Resolved from: per-model maxWorkers → workflow maxWorkersPerLevel → default 2. */
  levelMaxWorkers: Record<string, number>;
  levels: string[];
  defaultLevel: string;
  /** Flattened model map (string IDs only, for existing consumers). */
  models: Record<string, string>;
  emoji: Record<string, string>;
  completionResults: string[];
  enabled: boolean;
};
