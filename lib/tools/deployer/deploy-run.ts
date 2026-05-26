import type { ToolContext } from "../../types.js";
import type { PluginContext } from "../../context.js";
import { jsonResult, requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";
import { resolveRepoPath } from "../../projects/index.js";
import { loadConfig } from "../../config/index.js";
import { runDeployEngine } from "../../deployer/engine.js";
import { renderDeployReceiptSummary } from "../../deployer/receipt.js";

export function createDeployRunTool(ctx: PluginContext) {
  return (_toolCtx: ToolContext) => ({
    name: "deploy_run",
    label: "Deploy Run",
    description: "Run a direct deploy, promote, accept, or rollback operation using the shared deployer engine.",
    parameters: {
      type: "object",
      required: ["channelId", "action", "targetLane"],
      properties: {
        channelId: { type: "string" },
        messageThreadId: { type: "number" },
        action: { type: "string", enum: ["deploy", "promote", "accept", "rollback"] },
        targetLane: { type: "string", description: "Destination lane or alias" },
        sourceLane: { type: "string", description: "Origin lane or alias" },
        candidateRef: { type: "string" },
        issueId: { type: "number" },
        issueLinkage: { type: "string", enum: ["none", "comment", "workflow"] },
        dryRun: { type: "boolean" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(_toolCtx);
      const channelId = resolveChannelId(_toolCtx, params.channelId as string | undefined);
      const messageThreadId = params.messageThreadId as number | undefined;
      const channelType = (_toolCtx.messageChannel as string | undefined) ?? "telegram";
      const accountId = _toolCtx.agentAccountId as string | undefined;
      const { project } = await resolveProject(workspaceDir, channelId, { channel: channelType, accountId, messageThreadId });
      const { provider } = await resolveProvider(project, ctx.runCommand);
      const config = await loadConfig(workspaceDir, project.name);
      const repoPath = resolveRepoPath(project.repo);

      const issueLinkage = (params.issueLinkage as "none" | "comment" | "workflow" | undefined)
        ?? (params.issueId ? "comment" : "none");
      if ((issueLinkage === "comment" || issueLinkage === "workflow") && !params.issueId) {
        throw new Error(`issueLinkage=${issueLinkage} requires issueId`);
      }

      const result = await runDeployEngine({
        workspaceDir,
        project,
        repoPath,
        config: config.deployment,
        provider,
        runCommand: ctx.runCommand,
        request: {
          action: params.action as "deploy" | "promote" | "accept" | "rollback",
          targetLane: params.targetLane as string,
          sourceLane: params.sourceLane as string | undefined,
          candidateRef: params.candidateRef as string | undefined,
          issueId: params.issueId as number | undefined,
          dryRun: (params.dryRun as boolean) ?? false,
          issueLinkage,
          invocation: { kind: "direct" },
        },
        finalizeReceipt: async (receipt) => {
          if (params.issueId && issueLinkage !== "none") {
            receipt.linkedIssueCommentId = await provider.addComment(params.issueId as number, renderDeployReceiptSummary(receipt));
          }
        },
      });

      const linkedIssueCommentId = result.receipt.linkedIssueCommentId ?? null;

      return jsonResult({
        success: result.receipt.success,
        action: result.receipt.action,
        transition: {
          sourceLane: result.receipt.sourceLane,
          targetLane: result.receipt.targetLane,
          transitionKey: result.receipt.transitionKey,
        },
        candidate: result.receipt.candidate,
        receiptId: result.receipt.id,
        receiptPath: result.receipt.receiptPath,
        issueLinkage: result.receipt.issueLinkage,
        linkedIssueCommentId,
        dryRun: result.receipt.dryRun,
      });
    },
  });
}
