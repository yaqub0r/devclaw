/**
 * config/schema.ts — Zod validation for DevClaw workflow config.
 *
 * Validates workflow YAML at load time with clear error messages.
 * Enforces: transition targets exist, queue states have roles,
 * terminal states have no outgoing transitions.
 */
import { z } from "zod";
import { StateType } from "../workflow/index.js";

const STATE_TYPES = Object.values(StateType) as [string, ...string[]];

const TransitionTargetSchema = z.union([
  z.string(),
  z.object({
    target: z.string(),
    actions: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
]);

const StateConfigSchema = z.object({
  type: z.enum(STATE_TYPES),
  role: z.string().optional(),
  label: z.string(),
  color: z.string(),
  priority: z.number().optional(),
  description: z.string().optional(),
  check: z.string().optional(),
  on: z.record(z.string(), TransitionTargetSchema).optional(),
});

const DeliveryPhaseSchema = z.object({
  policy: z.enum(["human", "agent", "skip"]).optional(),
  queueState: z.string().optional(),
  activeState: z.string().optional(),
}).optional();

const WorkflowConfigSchema = z.object({
  initial: z.string(),
  reviewPolicy: z.enum(["human", "agent", "skip"]).optional(),
  testPolicy: z.enum(["skip", "agent"]).optional(),
  delivery: z.object({
    promotion: DeliveryPhaseSchema,
    acceptance: DeliveryPhaseSchema,
  }).optional(),
  roleExecution: z.enum(["parallel", "sequential"]).optional(),
  maxWorkersPerLevel: z.number().int().positive().optional(),
  states: z.record(z.string(), StateConfigSchema),
});

const ModelEntrySchema = z.union([
  z.string(),
  z.object({
    model: z.string(),
    maxWorkers: z.number().int().positive().optional(),
  }),
]);

const RoleOverrideSchema = z.union([
  z.literal(false),
  z.object({
    maxWorkers: z.number().int().positive().optional(), // deprecated, kept for backward compat
    levels: z.array(z.string()).optional(),
    defaultLevel: z.string().optional(),
    models: z.record(z.string(), ModelEntrySchema).optional(),
    emoji: z.record(z.string(), z.string()).optional(),
    completionResults: z.array(z.string()).optional(),
  }),
]);

const TimeoutConfigSchema = z.object({
  gitPullMs: z.number().positive().optional(),
  gatewayMs: z.number().positive().optional(),
  sessionPatchMs: z.number().positive().optional(),
  dispatchMs: z.number().positive().optional(),
  staleWorkerHours: z.number().positive().optional(),
  sessionContextBudget: z.number().min(0).max(1).optional(),
}).optional();

const DeploymentLaneSchema = z.object({
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  humanOnly: z.boolean().optional(),
  protected: z.boolean().optional(),
  rollbackTargets: z.array(z.string()).optional(),
  legacyBranch: z.string().optional(),
  legacyUrl: z.string().optional(),
});

const DeploymentCommandSchema = z.object({
  run: z.string(),
  cwd: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});

const DeploymentEvidenceProfileSchema = z.object({
  required: z.array(z.string()).optional(),
  commentSummary: z.boolean().optional(),
});

const DeploymentTransitionSchema = z.object({
  action: z.enum(["deploy", "promote", "accept", "rollback"]),
  from: z.string().optional(),
  to: z.string(),
  command: z.string(),
  evidence: z.string().optional(),
  requireCandidate: z.boolean().optional(),
});

const DeploymentSchema = z.object({
  lanes: z.record(z.string(), DeploymentLaneSchema).optional(),
  commands: z.record(z.string(), DeploymentCommandSchema).optional(),
  evidenceProfiles: z.record(z.string(), DeploymentEvidenceProfileSchema).optional(),
  transitions: z.array(DeploymentTransitionSchema).optional(),
  workflow: z.object({
    states: z.record(z.string(), z.object({
      action: z.enum(["deploy", "promote", "accept", "rollback"]),
      targetLane: z.string(),
      sourceLane: z.string().optional(),
      issueLinkage: z.enum(["none", "comment", "workflow"]).optional(),
    })).optional(),
  }).optional(),
  candidate: z.object({
    sources: z.array(z.enum(["explicit", "issueCandidate", "issuePr", "gitHead"])) .optional(),
  }).optional(),
  policy: z.object({
    allowDirectWithoutIssue: z.boolean().optional(),
    requireHumanForProtectedLanes: z.boolean().optional(),
  }).optional(),
}).optional();

const InstanceConfigSchema = z.object({
  name: z.string().optional(),
}).optional();

export const DevClawConfigSchema = z.object({
  roles: z.record(z.string(), RoleOverrideSchema).optional(),
  workflow: WorkflowConfigSchema.partial().optional(),
  deployment: DeploymentSchema,
  timeouts: TimeoutConfigSchema,
  instance: InstanceConfigSchema,
});

/**
 * Validate a raw parsed config object.
 * Returns the validated config or throws with a descriptive error.
 */
export function validateConfig(raw: unknown): void {
  const parsed = DevClawConfigSchema.parse(raw);
  const deployment = parsed.deployment;
  if (!deployment) return;

  const laneKeys = new Set(Object.keys(deployment.lanes ?? {}));
  const aliases = new Map<string, string>();
  for (const [lane, cfg] of Object.entries(deployment.lanes ?? {})) {
    for (const alias of [lane, ...(cfg.aliases ?? [])]) {
      const normalized = alias.trim().toLowerCase();
      const existing = aliases.get(normalized);
      if (existing && existing !== lane) {
        throw new Error(`Invalid deployment config: alias "${alias}" is used by both "${existing}" and "${lane}"`);
      }
      aliases.set(normalized, lane);
    }
    for (const rollbackTarget of cfg.rollbackTargets ?? []) {
      if (!laneKeys.has(rollbackTarget)) {
        throw new Error(`Invalid deployment config: lane "${lane}" rollback target "${rollbackTarget}" does not exist`);
      }
    }
  }

  for (const transition of deployment.transitions ?? []) {
    if (transition.from && !laneKeys.has(transition.from)) {
      throw new Error(`Invalid deployment config: transition from lane "${transition.from}" does not exist`);
    }
    if (!laneKeys.has(transition.to)) {
      throw new Error(`Invalid deployment config: transition to lane "${transition.to}" does not exist`);
    }
    if (!deployment.commands?.[transition.command]) {
      throw new Error(`Invalid deployment config: transition command "${transition.command}" does not exist`);
    }
    if (transition.evidence && !deployment.evidenceProfiles?.[transition.evidence]) {
      throw new Error(`Invalid deployment config: transition evidence profile "${transition.evidence}" does not exist`);
    }
  }

  for (const [stateKey, stateCfg] of Object.entries(deployment.workflow?.states ?? {})) {
    if (!laneKeys.has(stateCfg.targetLane)) {
      throw new Error(`Invalid deployment config: workflow state "${stateKey}" target lane "${stateCfg.targetLane}" does not exist`);
    }
    if (stateCfg.sourceLane && !laneKeys.has(stateCfg.sourceLane)) {
      throw new Error(`Invalid deployment config: workflow state "${stateKey}" source lane "${stateCfg.sourceLane}" does not exist`);
    }
  }
}

/**
 * Validate structural integrity of a fully-resolved workflow config.
 * Checks cross-references that Zod schema alone can't enforce:
 * - All transition targets point to existing states
 * - Queue states have a role assigned
 * - Terminal states have no outgoing transitions
 */
export function validateWorkflowIntegrity(
  workflow: { initial: string; delivery?: { promotion?: { queueState?: string; activeState?: string }; acceptance?: { queueState?: string; activeState?: string } }; states: Record<string, { type: string; role?: string; on?: Record<string, unknown> }> },
): string[] {
  const errors: string[] = [];
  const stateKeys = new Set(Object.keys(workflow.states));

  if (!stateKeys.has(workflow.initial)) {
    errors.push(`Initial state "${workflow.initial}" does not exist in states`);
  }

  const validateDeliveryRef = (phase: "promotion" | "acceptance", stateKind: "queueState" | "activeState", value?: string) => {
    if (!value) return;
    if (!stateKeys.has(value)) {
      errors.push(`workflow.delivery.${phase}.${stateKind} references non-existent state "${value}"`);
      return;
    }
    const state = workflow.states[value];
    const expectedType = stateKind === "queueState" ? StateType.QUEUE : StateType.ACTIVE;
    const expectedRole = phase === "promotion" || phase === "acceptance" ? "deployer" : undefined;
    if (state?.type !== expectedType) {
      errors.push(`workflow.delivery.${phase}.${stateKind} must reference a ${expectedType} state`);
    }
    if (expectedRole && state?.role !== expectedRole) {
      errors.push(`workflow.delivery.${phase}.${stateKind} must reference a ${expectedRole}-owned state`);
    }
  };

  validateDeliveryRef("promotion", "queueState", workflow.delivery?.promotion?.queueState);
  validateDeliveryRef("promotion", "activeState", workflow.delivery?.promotion?.activeState);
  validateDeliveryRef("acceptance", "queueState", workflow.delivery?.acceptance?.queueState);
  validateDeliveryRef("acceptance", "activeState", workflow.delivery?.acceptance?.activeState);

  for (const [key, state] of Object.entries(workflow.states)) {
    if (state.type === StateType.QUEUE && !state.role) {
      errors.push(`Queue state "${key}" must have a role assigned`);
    }

    if (state.type === StateType.ACTIVE && !state.role) {
      errors.push(`Active state "${key}" must have a role assigned`);
    }

    if (state.type === StateType.TERMINAL && state.on && Object.keys(state.on).length > 0) {
      errors.push(`Terminal state "${key}" should not have outgoing transitions`);
    }

    if (state.on) {
      for (const [event, transition] of Object.entries(state.on)) {
        const target = typeof transition === "string"
          ? transition
          : (transition as { target: string }).target;
        if (!stateKeys.has(target)) {
          errors.push(`State "${key}" transition "${event}" targets non-existent state "${target}"`);
        }
      }
    }
  }

  return errors;
}
