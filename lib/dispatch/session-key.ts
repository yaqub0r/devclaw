import { getSessionKeyRolePattern } from "../roles/index.js";

export type DevClawWorkerSessionIdentity = {
  projectName: string;
  role: string;
};

/**
 * Parse the deterministic session identity assigned to a DevClaw worker.
 *
 * Supports both the current name-based suffix and the legacy level-only form.
 */
export function parseDevClawSessionKey(
  sessionKey: string,
): DevClawWorkerSessionIdentity | null {
  const rolePattern = getSessionKeyRolePattern();
  const currentMatch = sessionKey.match(
    new RegExp(`:subagent:(.+)-(${rolePattern})-[^-]+-[^-]+$`),
  );
  if (currentMatch) {
    return { projectName: currentMatch[1], role: currentMatch[2] };
  }

  const legacyMatch = sessionKey.match(
    new RegExp(`:subagent:(.+)-(${rolePattern})-[^-]+$`),
  );
  if (legacyMatch) {
    return { projectName: legacyMatch[1], role: legacyMatch[2] };
  }

  return null;
}
