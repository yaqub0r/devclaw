/**
 * tool-helpers.ts — Shared resolution helpers for tool execute() functions.
 *
 * Eliminates repeated boilerplate across tools: workspace validation,
 * project resolution, provider creation.
 */
import type { ToolContext } from "../types.js";

/**
 * Wrap a payload as a tool result with pretty-printed JSON text.
 * Replaces the removed `jsonResult` export from openclaw/plugin-sdk.
 */
export function jsonResult(payload: unknown): { content: { type: "text"; text: string }[]; details: unknown } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
}
import type { RunCommand } from "../context.js";
import { readProjects, getProject, type Project, type ProjectsData } from "../projects/index.js";
import { createProvider, type ProviderWithType } from "../providers/index.js";
import { loadConfig } from "../config/index.js";
import { loadInstanceName } from "../instance.js";
import { getOwnerLabel, OWNER_LABEL_COLOR, getNotifyLabel, NOTIFY_LABEL_PREFIX, NOTIFY_LABEL_COLOR } from "../workflow/index.js";
import { parseDevClawSessionKey } from "../dispatch/session-key.js";

/**
 * Require workspaceDir from context or throw a clear error.
 */
export function requireWorkspaceDir(ctx: ToolContext): string {
  if (!ctx.workspaceDir) {
    throw new Error("No workspace directory available in tool context");
  }
  return ctx.workspaceDir;
}

/**
 * Resolve the channelId from explicit tool param.
 */
export function resolveChannelId(_ctx: ToolContext, explicitChannelId?: string): string {
  if (!explicitChannelId) {
    throw new Error(
      "channelId is required. Pass YOUR chat/group ID (the numeric ID of the chat you are in right now).",
    );
  }
  return explicitChannelId;
}

/**
 * Resolve project by channelId (or slug for backward compat).
 * Throws with actionable guidance if not found.
 */
export async function resolveProject(
  workspaceDir: string,
  channelId: string,
  opts?: {
    channel?: string;
    accountId?: string;
    messageThreadId?: number | string | null;
    sessionKey?: string;
  },
): Promise<{ data: ProjectsData; project: Project }> {
  const data = await readProjects(workspaceDir);
  const workerResolution = resolveWorkerSessionProject(
    data,
    opts?.sessionKey,
    channelId,
    opts?.messageThreadId,
  );
  const project = workerResolution.recognized
    ? workerResolution.project
    : opts
      ? getProject(data, {
          channelId,
          channel: opts.channel,
          accountId: opts.accountId,
          messageThreadId: opts.messageThreadId,
        })
      : getProject(data, channelId);
  if (!project) {
    throw new Error(
      `No project found for "${channelId}". ` +
      `Register a new project with project_register, or link this channel to an existing project.`,
    );
  }
  return { data, project };
}

/**
 * Resolve a tool call using trusted worker identity before chat transport scope.
 *
 * Native plugin subagent turns currently surface as `webchat`, even when the
 * worker belongs to a project registered on another transport. The
 * deterministic session key and persisted worker slot are authoritative for
 * those calls. Ordinary chat calls retain the existing
 * channel/account/topic-aware lookup.
 */
export async function resolveToolProject(
  workspaceDir: string,
  toolCtx: ToolContext,
  channelId: string,
  messageThreadId?: number | string | null,
): Promise<{ data: ProjectsData; project: Project }> {
  return resolveProject(workspaceDir, channelId, {
    channel: toolCtx.messageChannel ?? "telegram",
    accountId: toolCtx.agentAccountId,
    messageThreadId,
    sessionKey: toolCtx.sessionKey,
  });
}

function resolveWorkerSessionProject(
  data: ProjectsData,
  sessionKey: string | undefined,
  channelId: string,
  messageThreadId?: number | string | null,
): { recognized: boolean; project?: Project } {
  if (!sessionKey) return { recognized: false };

  const identity = parseDevClawSessionKey(sessionKey);
  if (!identity) return { recognized: false };

  const project = getProject(data, identity.projectName);
  if (!project) return { recognized: true };

  const normalizedSessionKey = sessionKey.toLowerCase();
  const roleWorker = project.workers[identity.role];
  const sessionIsActive = roleWorker
    ? Object.values(roleWorker.levels).some((slots) =>
        slots.some((slot) =>
          slot.active &&
          slot.sessionKey?.toLowerCase() === normalizedSessionKey
        ),
      )
    : false;
  if (!sessionIsActive) return { recognized: true };

  const routeBelongsToProject =
    (project.slug === channelId && messageThreadId == null) ||
    project.channels.some((channel) =>
      channel.channelId === channelId &&
      (
        messageThreadId == null ||
        channel.messageThreadId == null ||
        String(channel.messageThreadId) === String(messageThreadId)
      ),
    );
  if (!routeBelongsToProject) return { recognized: true };

  return { recognized: true, project };
}

/**
 * Create an issue provider for a project.
 * Uses stored provider type from project config if available, otherwise auto-detects.
 */
export async function resolveProvider(project: Project, runCommand: RunCommand): Promise<ProviderWithType> {
  const target = project.repoRemote ? { repo: normalizeRepoTarget(project.repoRemote) } : undefined;
  return createProvider({ repo: project.repo, provider: project.provider, target, runCommand });
}

export function normalizeRepoTarget(repoRemote: string): string | undefined {
  const trimmed = repoRemote.trim();
  if (!trimmed) return undefined;

  const sshMatch = trimmed.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i)
    ?? trimmed.match(/gitlab\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];

  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
    return path || undefined;
  } catch {
    return trimmed.replace(/\.git$/i, "");
  }
}

/**
 * Auto-assign owner label to an issue based on the current instance.
 *
 * This ensures that when a task tool creates or modifies an issue,
 * it automatically claims ownership for the executing instance.
 * Best-effort: failures are logged but don't block the operation.
 */
/**
 * Apply a notify label to an issue for notification channel routing.
 *
 * Each issue has at most one notify label. If the source channel differs
 * from the existing label, the old one is replaced.
 * Best-effort: failures are silently ignored.
 *
 * @param sourceChannelId — The channelId the request came from (optional).
 *   When provided, routes to the matching channel. Falls back to first channel.
 */
export function applyNotifyLabel(
  provider: ProviderWithType["provider"],
  issueId: number,
  project: Project,
  sourceChannelId?: string,
  existingLabels?: string[],
): void {
  const sourceChannel =
    (sourceChannelId ? project.channels.find(ch => ch.channelId === sourceChannelId) : undefined) ??
    project.channels[0];
  if (!sourceChannel) return;

  const notifyLabel = getNotifyLabel(sourceChannel.channel, sourceChannel.name ?? "0");
  const staleLabels = existingLabels?.filter(l => l.startsWith(NOTIFY_LABEL_PREFIX) && l !== notifyLabel) ?? [];
  const hasCorrectLabel = existingLabels?.includes(notifyLabel) ?? false;

  // Nothing to do — correct label present, no stale labels
  if (hasCorrectLabel && staleLabels.length === 0) return;

  const apply = async () => {
    if (staleLabels.length > 0) {
      await provider.removeLabels(issueId, staleLabels);
    }
    if (!hasCorrectLabel) {
      await provider.ensureLabel(notifyLabel, NOTIFY_LABEL_COLOR);
      await provider.addLabel(issueId, notifyLabel);
    }
  };
  apply().catch(() => {});
}

/**
 * Auto-assign owner label to an issue based on the current instance.
 *
 * This ensures that when a task tool creates or modifies an issue,
 * it automatically claims ownership for the executing instance.
 * Best-effort: failures are logged but don't block the operation.
 */
export async function autoAssignOwnerLabel(
  workspaceDir: string,
  provider: ProviderWithType["provider"],
  issueId: number,
  project: Project,
): Promise<void> {
  try {
    const resolvedConfig = await loadConfig(workspaceDir, project.name);
    const instanceName = await loadInstanceName(
      workspaceDir,
      resolvedConfig.instanceName,
    );
    const ownerLabel = getOwnerLabel(instanceName);

    // Ensure the owner label exists in the issue tracker
    await provider.ensureLabel(ownerLabel, OWNER_LABEL_COLOR);

    // Add the owner label to the issue
    await provider.addLabel(issueId, ownerLabel);
  } catch (error) {
    // Log but don't block: auto-assigning owner label is best-effort
    console.warn(`Failed to auto-assign owner label to issue #${issueId}:`, error);
  }
}
