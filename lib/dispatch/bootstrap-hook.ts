/**
 * bootstrap-hook.ts — Bootstrap support for DevClaw sessions.
 *
 * Provides:
 *   1. agent:bootstrap (internal hook) for worker sessions, replacing the
 *      orchestrator's AGENTS.md with role-specific instructions so workers see
 *      their own prompt on every turn.
 *   2. agent:bootstrap handling for main/orchestrator sessions, injecting one
 *      resolved orchestrator prompt as a separate bootstrap file instead of
 *      piggybacking on AGENTS.md.
 *   3. Prompt loaders used by bootstrap and dispatch fallback paths.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginContext } from "../context.js";
import { getSessionKeyRolePattern } from "../roles/index.js";
import { getProject, readProjects } from "../projects/index.js";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { DEFAULT_ORCHESTRATOR_PROMPT, DEFAULT_ROLE_INSTRUCTIONS } from "../setup/templates.js";

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

export type PromptSourceResult = {
  content: string;
  source: string | null;
};

export type RoleInstructionsResult = PromptSourceResult;

async function loadPromptInstructions(
  workspaceDir: string,
  promptName: string,
  opts?: { projectName?: string; withSource?: boolean; includePackageDefault?: string },
): Promise<string | PromptSourceResult> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const candidates = [
    opts?.projectName
      ? path.join(dataDir, "projects", opts.projectName, "prompts", `${promptName}.md`)
      : null,
    opts?.projectName
      ? path.join(workspaceDir, "projects", "roles", opts.projectName, `${promptName}.md`)
      : null,
    path.join(dataDir, "prompts", `${promptName}.md`),
    path.join(workspaceDir, "projects", "roles", "default", `${promptName}.md`),
  ].filter((value): value is string => Boolean(value));

  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (opts?.withSource) return { content, source: filePath };
      return content;
    } catch {
      /* not found, try next */
    }
  }

  if (opts?.includePackageDefault) {
    if (opts.withSource) return { content: opts.includePackageDefault, source: "package-default" };
    return opts.includePackageDefault;
  }

  if (opts?.withSource) return { content: "", source: null };
  return "";
}

/**
 * Load role-specific instructions from workspace.
 * Resolution order:
 *   1. devclaw/projects/<project>/prompts/<role>.md
 *   2. projects/roles/<project>/<role>.md
 *   3. devclaw/prompts/<role>.md
 *   4. projects/roles/default/<role>.md
 *   5. package default
 */
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
): Promise<RoleInstructionsResult>;
export async function loadRoleInstructions(
  workspaceDir: string,
  projectName: string,
  role: string,
  opts?: { withSource: true },
): Promise<string | RoleInstructionsResult> {
  return loadPromptInstructions(workspaceDir, role, {
    projectName,
    withSource: opts?.withSource,
    includePackageDefault: DEFAULT_ROLE_INSTRUCTIONS[role],
  }) as Promise<string | RoleInstructionsResult>;
}

/**
 * Load orchestrator-specific instructions from workspace.
 * Resolution order for the dedicated orchestrator bootstrap file:
 *   1. devclaw/projects/<project>/prompts/orchestrator.md
 *   2. projects/roles/<project>/orchestrator.md
 *   3. devclaw/prompts/orchestrator.md
 *   4. projects/roles/default/orchestrator.md
 *   5. package default
 *
 * AGENTS.md remains the baseline bootstrap context outside this loader. The
 * returned content is injected as a separate bootstrap file named
 * orchestrator.md so operators see the real editable prompt name directly.
 */
export async function loadOrchestratorInstructions(
  workspaceDir: string,
  projectName?: string,
): Promise<string>;
export async function loadOrchestratorInstructions(
  workspaceDir: string,
  projectName: string | undefined,
  opts: { withSource: true },
): Promise<PromptSourceResult>;
export async function loadOrchestratorInstructions(
  workspaceDir: string,
  projectName?: string,
  opts?: { withSource: true },
): Promise<string | PromptSourceResult> {
  return loadPromptInstructions(workspaceDir, "orchestrator", {
    projectName,
    withSource: opts?.withSource,
    includePackageDefault: DEFAULT_ORCHESTRATOR_PROMPT.trim(),
  }) as Promise<string | PromptSourceResult>;
}

async function resolveProjectNameForBootstrap(
  workspaceDir: string,
  context: {
    projectName?: string;
    projectSlug?: string;
    channelId?: string;
    conversationId?: string;
    messageThreadId?: number | string | null;
    accountId?: string;
    channel?: string;
  },
): Promise<string | undefined> {
  if (context.projectName) return context.projectName;
  if (context.projectSlug) return context.projectSlug;

  const channelId = context.channelId ?? context.conversationId;
  if (!channelId) return undefined;

  try {
    const data = await readProjects(workspaceDir);
    return getProject(data, {
      channelId,
      channel: context.channel ?? "telegram",
      accountId: context.accountId,
      messageThreadId: context.messageThreadId,
    })?.name;
  } catch {
    return undefined;
  }
}

/**
 * Register the agent:bootstrap hook for DevClaw sessions.
 *
 * Worker precedence:
 *   1. devclaw/projects/<project>/prompts/<role>.md
 *   2. devclaw/prompts/<role>.md
 *   3. package default prompt
 *
 * Orchestrator precedence inside bootstrap context:
 *   1. existing AGENTS.md/runtime baseline
 *   2. orchestrator.md from the resolved orchestrator prompt source
 *   3. issue/task/chat-specific context (outside this hook)
 */
export function registerBootstrapHook(api: OpenClawPluginApi, ctx: PluginContext): void {
  api.registerHook(
    "agent:bootstrap",
    async (event) => {
      const sessionKey = event.sessionKey;
      if (!sessionKey) return;

      const context = event.context as {
        workspaceDir?: string;
        projectName?: string;
        projectSlug?: string;
        channelId?: string;
        conversationId?: string;
        messageThreadId?: number | string | null;
        accountId?: string;
        channel?: string;
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

      const parsed = parseDevClawSessionKey(sessionKey);
      const workspaceDir = context.workspaceDir;

      if (!workspaceDir) {
        if (!parsed) return;
        agentsEntry.content = "";
        agentsEntry.missing = true;
        ctx.logger.info(
          `agent:bootstrap: stripped AGENTS.md for ${parsed.role} worker in "${parsed.projectName}" (no workspaceDir)`,
        );
        return;
      }

      if (!parsed) {
        const projectName = await resolveProjectNameForBootstrap(workspaceDir, context);
        const { content, source } = await loadOrchestratorInstructions(workspaceDir, projectName, { withSource: true });
        if (!content.trim()) return;

        const promptFileName = "orchestrator.md";
        const existingPromptEntry = bootstrapFiles.find((f) => f.name === promptFileName);
        const promptEntry = existingPromptEntry ?? {
          name: promptFileName,
          path: path.join(workspaceDir, promptFileName),
          content: "",
          missing: false,
        };

        promptEntry.content = content.trim();
        promptEntry.missing = false;
        if (!existingPromptEntry) bootstrapFiles.push(promptEntry);

        ctx.logger.info(
          `agent:bootstrap: injected orchestrator prompt file${projectName ? ` for "${projectName}"` : ""} from ${source}`,
        );
        return;
      }

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
    },
    {
      name: "devclaw-bootstrap-role-instructions",
      description:
        "Replaces worker AGENTS.md with role prompts and injects live orchestrator prompts for main sessions",
    } as any,
  );
}
