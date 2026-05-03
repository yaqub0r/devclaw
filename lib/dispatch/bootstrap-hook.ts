/**
 * bootstrap-hook.ts — Bootstrap support for DevClaw worker and orchestrator sessions.
 *
 * Provides:
 *   1. agent:bootstrap (internal hook) — replaces the orchestrator's AGENTS.md
 *      with role-specific instructions for workers and injects a single resolved
 *      orchestrator.md for main orchestrator sessions.
 *   2. loadRoleInstructions() — loads role-specific prompt files from workspace.
 *   3. loadOrchestratorInstructions() — loads the winner-takes-all orchestrator prompt.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginContext } from "../context.js";
import { getProject, readProjects } from "../projects/index.js";
import { getSessionKeyRolePattern } from "../roles/index.js";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { DEFAULT_ORCHESTRATOR_INSTRUCTIONS, DEFAULT_ROLE_INSTRUCTIONS } from "../setup/templates.js";

export function parseDevClawSessionKey(
  sessionKey: string,
): { projectName: string; role: string } | null {
  const rolePattern = getSessionKeyRolePattern();
  const newMatch = sessionKey.match(
    new RegExp(`:subagent:(.+)-(${rolePattern})-[^-]+-[^-]+$`),
  );
  if (newMatch) return { projectName: newMatch[1], role: newMatch[2] };
  const legacyMatch = sessionKey.match(
    new RegExp(`:subagent:(.+)-(${rolePattern})-[^-]+$`),
  );
  if (legacyMatch) return { projectName: legacyMatch[1], role: legacyMatch[2] };
  return null;
}

export type PromptInstructionsResult = {
  content: string;
  source: string | null;
};

export async function loadRoleInstructions(
  workspaceDir: string,
  projectName: string,
  role: string,
): Promise<string>;
export async function loadRoleInstructions(
  workspaceDir: string,
  projectName: string,
  role: string,
  opts: { withSource: true },
): Promise<PromptInstructionsResult>;
export async function loadRoleInstructions(
  workspaceDir: string,
  projectName: string,
  role: string,
  opts?: { withSource: true },
): Promise<string | PromptInstructionsResult> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const candidates = [
    path.join(dataDir, "projects", projectName, "prompts", `${role}.md`),
    path.join(workspaceDir, "projects", "roles", projectName, `${role}.md`),
    path.join(dataDir, "prompts", `${role}.md`),
    path.join(workspaceDir, "projects", "roles", "default", `${role}.md`),
  ];

  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (opts?.withSource) return { content, source: filePath };
      return content;
    } catch {
      /* not found, try next */
    }
  }

  const packageDefault = DEFAULT_ROLE_INSTRUCTIONS[role];
  if (packageDefault) {
    if (opts?.withSource) return { content: packageDefault, source: "package-default" };
    return packageDefault;
  }

  if (opts?.withSource) return { content: "", source: null };
  return "";
}

export async function loadOrchestratorInstructions(
  workspaceDir: string,
  projectName?: string,
): Promise<string>;
export async function loadOrchestratorInstructions(
  workspaceDir: string,
  projectName: string | undefined,
  opts: { withSource: true },
): Promise<PromptInstructionsResult>;
export async function loadOrchestratorInstructions(
  workspaceDir: string,
  projectName?: string,
  opts?: { withSource: true },
): Promise<string | PromptInstructionsResult> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const candidates = [
    ...(projectName
      ? [path.join(dataDir, "projects", projectName, "prompts", "orchestrator.md")]
      : []),
    path.join(dataDir, "prompts", "orchestrator.md"),
  ];

  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (opts?.withSource) return { content, source: filePath };
      return content;
    } catch {
      /* not found, try next */
    }
  }

  if (DEFAULT_ORCHESTRATOR_INSTRUCTIONS) {
    if (opts?.withSource) {
      return { content: DEFAULT_ORCHESTRATOR_INSTRUCTIONS, source: "package-default" };
    }
    return DEFAULT_ORCHESTRATOR_INSTRUCTIONS;
  }

  if (opts?.withSource) return { content: "", source: null };
  return "";
}

const MAIN_SESSION_PATTERNS = [
  /^agent:[^:]+:main$/,
  /^agent:[^:]+:main:main$/,
  /^agent:[^:]+:(telegram|whatsapp|discord|slack):(group|dm|channel):[^:]+(?::topic:[^:]+)?$/,
];

export function isMainOrchestratorSession(sessionKey: string): boolean {
  return MAIN_SESSION_PATTERNS.some((pattern) => pattern.test(sessionKey));
}

export type OrchestratorSessionScope = {
  channel: string;
  channelId: string;
  messageThreadId?: string;
};

export function parseMainOrchestratorSessionScope(
  sessionKey: string,
): OrchestratorSessionScope | null {
  const match = sessionKey.match(
    /^agent:[^:]+:(telegram|whatsapp|discord|slack):(group|dm|channel):([^:]+)(?::topic:([^:]+))?$/,
  );
  if (!match) return null;
  return {
    channel: match[1],
    channelId: match[3],
    ...(match[4] ? { messageThreadId: match[4] } : {}),
  };
}

async function resolveProjectNameForBootstrap(
  workspaceDir: string,
  context: Record<string, unknown>,
  sessionKey?: string,
): Promise<string | undefined> {
  const sessionScope = sessionKey ? parseMainOrchestratorSessionScope(sessionKey) : null;
  const channelId =
    (typeof context.channelId === "string" && context.channelId.trim() ? context.channelId : undefined) ??
    (typeof context.conversationId === "string" && context.conversationId.trim()
      ? context.conversationId
      : undefined) ??
    (typeof context.peerId === "string" && context.peerId.trim() ? context.peerId : undefined) ??
    sessionScope?.channelId;

  if (!channelId) return undefined;

  const messageThreadId =
    typeof context.messageThreadId === "number" || typeof context.messageThreadId === "string"
      ? context.messageThreadId
      : typeof context.threadId === "number" || typeof context.threadId === "string"
        ? context.threadId
        : sessionScope?.messageThreadId;

  try {
    const data = await readProjects(workspaceDir);
    const project = getProject(data, {
      channelId,
      channel:
        typeof context.channel === "string" && context.channel.trim()
          ? context.channel
          : sessionScope?.channel ?? "telegram",
      accountId: typeof context.accountId === "string" ? context.accountId : undefined,
      messageThreadId,
    });
    return project?.name;
  } catch {
    return undefined;
  }
}

export function registerBootstrapHook(api: OpenClawPluginApi, ctx: PluginContext): void {
  api.registerHook(
    "agent:bootstrap",
    async (event) => {
      const sessionKey = event.sessionKey;
      if (!sessionKey) return;

      const parsed = parseDevClawSessionKey(sessionKey);
      const isOrchestrator = isMainOrchestratorSession(sessionKey);
      if (!parsed && !isOrchestrator) return;

      const context = event.context as {
        workspaceDir?: string;
        channelId?: string;
        conversationId?: string;
        peerId?: string;
        channel?: string;
        accountId?: string;
        threadId?: number | string;
        messageThreadId?: number | string;
        bootstrapFiles?: Array<{
          name: string;
          path: string;
          content?: string;
          missing: boolean;
        }>;
      };

      const bootstrapFiles = context.bootstrapFiles;
      if (!Array.isArray(bootstrapFiles)) return;

      const agentsEntry = bootstrapFiles.find((f) => f.name === "AGENTS.md");
      if (!agentsEntry) return;

      const workspaceDir = context.workspaceDir;
      if (!workspaceDir) {
        if (parsed) {
          agentsEntry.content = "";
          agentsEntry.missing = true;
          ctx.logger.info(
            `agent:bootstrap: stripped AGENTS.md for ${parsed.role} worker in "${parsed.projectName}" (no workspaceDir)`,
          );
        }
        return;
      }

      if (parsed) {
        const { content, source } = await loadRoleInstructions(
          workspaceDir,
          parsed.projectName,
          parsed.role,
          { withSource: true },
        );

        if (content.trim()) {
          agentsEntry.content = content;
          agentsEntry.missing = false;
          ctx.logger.info(
            `agent:bootstrap: injected ${parsed.role} instructions for "${parsed.projectName}" from ${source}`,
          );
        } else {
          agentsEntry.content = "";
          agentsEntry.missing = true;
          ctx.logger.info(
            `agent:bootstrap: stripped AGENTS.md for ${parsed.role} worker in "${parsed.projectName}" (no role instructions found)`,
          );
        }
        return;
      }

      const projectName = await resolveProjectNameForBootstrap(
        workspaceDir,
        context as Record<string, unknown>,
        sessionKey,
      );
      const { content, source } = await loadOrchestratorInstructions(workspaceDir, projectName, {
        withSource: true,
      });
      if (!content.trim()) return;

      const existing = bootstrapFiles.find((f) => f.name === "orchestrator.md");
      if (existing) {
        existing.content = content;
        existing.missing = false;
      } else {
        bootstrapFiles.push({
          name: "orchestrator.md",
          path: path.join(workspaceDir, "orchestrator.md"),
          content,
          missing: false,
        });
      }

      const synthetic = bootstrapFiles.find((f) => f.name === "DEVCLAW_ORCHESTRATOR_PROMPT.md");
      if (synthetic) {
        synthetic.content = "";
        synthetic.missing = true;
      }

      ctx.logger.info(
        `agent:bootstrap: injected orchestrator instructions${projectName ? ` for "${projectName}"` : ""} from ${source}`,
      );
    },
    {
      name: "devclaw-bootstrap-role-instructions",
      description:
        "Replaces orchestrator AGENTS.md with role-specific instructions for DevClaw workers",
    } as any,
  );
}
