/**
 * config/merge.ts — Deep merge for DevClaw config layers.
 *
 * Merge semantics:
 * - Objects: recursively merge (sparse override)
 * - Arrays: replace entirely (no merging array elements)
 * - `false` for a role: marks it as disabled
 * - Primitives: override
 */
import type { DeploymentConfig, DevClawConfig, RoleOverride } from "./types.js";

/**
 * Merge a config overlay on top of a base config.
 * Returns a new config — does not mutate inputs.
 */
export function mergeConfig(
  base: DevClawConfig,
  overlay: DevClawConfig,
): DevClawConfig {
  const merged: DevClawConfig = {};

  // Merge roles
  if (base.roles || overlay.roles) {
    merged.roles = { ...base.roles };
    if (overlay.roles) {
      for (const [roleId, overrideValue] of Object.entries(overlay.roles)) {
        if (overrideValue === false) {
          // Disable role
          merged.roles[roleId] = false;
        } else if (merged.roles[roleId] === false) {
          // Re-enable with override
          merged.roles[roleId] = overrideValue;
        } else {
          // Merge role override on top of base role
          const baseRole = merged.roles[roleId];
          merged.roles[roleId] = mergeRoleOverride(
            typeof baseRole === "object" ? baseRole : {},
            overrideValue,
          );
        }
      }
    }
  }

  // Merge workflow
  if (base.workflow || overlay.workflow) {
    merged.workflow = {
      initial: overlay.workflow?.initial ?? base.workflow?.initial,
      reviewPolicy: overlay.workflow?.reviewPolicy ?? base.workflow?.reviewPolicy,
      testPolicy: overlay.workflow?.testPolicy ?? base.workflow?.testPolicy,
      delivery: base.workflow?.delivery || overlay.workflow?.delivery
        ? {
            promotion: {
              ...base.workflow?.delivery?.promotion,
              ...overlay.workflow?.delivery?.promotion,
            },
            acceptance: {
              ...base.workflow?.delivery?.acceptance,
              ...overlay.workflow?.delivery?.acceptance,
            },
          }
        : undefined,
      roleExecution: overlay.workflow?.roleExecution ?? base.workflow?.roleExecution,
      maxWorkersPerLevel: overlay.workflow?.maxWorkersPerLevel ?? base.workflow?.maxWorkersPerLevel,
      states: {
        ...base.workflow?.states,
        ...overlay.workflow?.states,
      },
    };
    // Clean up undefined initial
    if (merged.workflow.initial === undefined) {
      delete merged.workflow.initial;
    }
  }

  if (base.deployment || overlay.deployment) {
    merged.deployment = mergeDeploymentConfig(base.deployment, overlay.deployment);
  }

  // Merge timeouts
  if (base.timeouts || overlay.timeouts) {
    merged.timeouts = { ...base.timeouts, ...overlay.timeouts };
  }

  return merged;
}

function mergeRoleOverride(
  base: RoleOverride,
  overlay: RoleOverride,
): RoleOverride {
  return {
    ...base,
    ...overlay,
    // Models: merge (don't replace)
    models: base.models || overlay.models
      ? { ...base.models, ...overlay.models }
      : undefined,
    // Emoji: merge (don't replace)
    emoji: base.emoji || overlay.emoji
      ? { ...base.emoji, ...overlay.emoji }
      : undefined,
    // Arrays replace entirely
    ...(overlay.levels ? { levels: overlay.levels } : {}),
    ...(overlay.completionResults ? { completionResults: overlay.completionResults } : {}),
  };
}

function mergeDeploymentConfig(
  base?: DeploymentConfig,
  overlay?: DeploymentConfig,
): DeploymentConfig {
  return {
    ...base,
    ...overlay,
    lanes: mergeRecordObjects(base?.lanes, overlay?.lanes),
    commands: mergeRecordObjects(base?.commands, overlay?.commands),
    evidenceProfiles: mergeRecordObjects(base?.evidenceProfiles, overlay?.evidenceProfiles),
    workflow: base?.workflow || overlay?.workflow
      ? {
          ...base?.workflow,
          ...overlay?.workflow,
          states: mergeRecordObjects(base?.workflow?.states, overlay?.workflow?.states),
        }
      : undefined,
    candidate: base?.candidate || overlay?.candidate
      ? { ...base?.candidate, ...overlay?.candidate }
      : undefined,
    policy: base?.policy || overlay?.policy
      ? { ...base?.policy, ...overlay?.policy }
      : undefined,
    transitions: overlay?.transitions ?? base?.transitions,
  };
}

function mergeRecordObjects<T extends object>(
  base?: Record<string, T>,
  overlay?: Record<string, T>,
): Record<string, T> | undefined {
  if (!base && !overlay) return undefined;

  const merged: Record<string, T> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(overlay ?? {})) {
    merged[key] = key in merged
      ? { ...merged[key], ...value }
      : value;
  }
  return merged;
}
