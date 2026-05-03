/**
 * config_reset — Reset user-owned config files to defaults.
 *
 * Creates .bak backups before overwriting. Supports selective reset
 * via the `target` parameter.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { jsonResult } from "../../json-result.js";
import type { ToolContext } from "../../types.js";
import type { PluginContext } from "../../context.js";
import { requireWorkspaceDir } from "../helpers.js";
import { backupAndWrite } from "../../setup/workspace.js";
import { WORKFLOW_YAML_TEMPLATE, DEFAULT_PROMPT_INSTRUCTIONS } from "../../setup/templates.js";
import { DATA_DIR } from "../../setup/migrate-layout.js";
import { log as auditLog } from "../../audit.js";

export function createConfigResetTool(_ctx: PluginContext) {
  return (toolCtx: ToolContext) => ({
    name: "config_reset",
    label: "Config Reset",
    description:
      "Reset DevClaw config files to defaults. Creates .bak backups before overwriting. " +
      "Use `target` to reset selectively: 'workflow' (workflow.yaml), 'prompts' (role prompts), or 'all' (both).",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "YOUR chat/group ID.",
        },
        target: {
          type: "string",
          enum: ["workflow", "prompts", "all"],
          description:
            "What to reset. 'workflow' = workflow.yaml, 'prompts' = devclaw/prompts/*.md (including orchestrator.md), 'all' = both. Default: 'all'.",
        },
      },
      required: ["channelId"],
    },
    execute: async (params: Record<string, unknown>) => {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const target = (params.target as string) ?? "all";
      const dataDir = path.join(workspaceDir, DATA_DIR);
      const resetFiles: string[] = [];

      if (target === "workflow" || target === "all") {
        const workflowPath = path.join(dataDir, "workflow.yaml");
        await backupAndWrite(workflowPath, WORKFLOW_YAML_TEMPLATE);
        resetFiles.push("devclaw/workflow.yaml");
      }

      if (target === "prompts" || target === "all") {
        const promptsDir = path.join(dataDir, "prompts");
        await fs.mkdir(promptsDir, { recursive: true });
        for (const [promptName, content] of Object.entries(DEFAULT_PROMPT_INSTRUCTIONS)) {
          if (!content) continue;
          const promptPath = path.join(promptsDir, `${promptName}.md`);
          await backupAndWrite(promptPath, content);
          resetFiles.push(`devclaw/prompts/${promptName}.md`);
        }
      }

      await auditLog(workspaceDir, "config_reset", { target, files: resetFiles });

      return jsonResult({
        reset: resetFiles,
        message: `Reset ${resetFiles.length} file(s) to defaults. Backups saved as .bak files.`,
      });
    },
  });
}
