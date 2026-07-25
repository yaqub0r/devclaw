import type { IssueProvider } from "../providers/provider.js";
import type { Project } from "../projects/index.js";
import type { DeploymentConfig } from "../config/types.js";
import type { RunCommand } from "../context.js";
import { getCurrentCandidate } from "../workflow/candidate-provenance.js";
import { runDeployEngine } from "./engine.js";
import { renderDeployReceiptSummary } from "./receipt.js";

export async function runWorkflowDeployment(opts: {
  workspaceDir: string;
  project: Project;
  repoPath: string;
  provider: IssueProvider;
  issueId: number;
  currentStateKey: string;
  config: DeploymentConfig;
  runCommand: RunCommand;
}): Promise<Awaited<ReturnType<typeof runDeployEngine>>> {
  const mapping = opts.config.workflow?.states?.[opts.currentStateKey];
  if (!mapping) {
    throw new Error(`No deployment.workflow.states entry configured for ${opts.currentStateKey}`);
  }

  const currentCandidate = await getCurrentCandidate(opts.provider, opts.issueId);
  const candidateRef = currentCandidate?.candidateId ?? currentCandidate?.commitSha ?? undefined;

  return runDeployEngine({
    workspaceDir: opts.workspaceDir,
    project: opts.project,
    repoPath: opts.repoPath,
    config: opts.config,
    provider: opts.provider,
    runCommand: opts.runCommand,
    request: {
      action: mapping.action,
      sourceLane: mapping.sourceLane,
      targetLane: mapping.targetLane,
      candidateRef,
      issueId: opts.issueId,
      issueLinkage: mapping.issueLinkage ?? "workflow",
      invocation: { kind: "workflow", stateKey: opts.currentStateKey },
    },
    finalizeReceipt: async (receipt) => {
      receipt.linkedIssueCommentId = await opts.provider.addComment(opts.issueId, renderDeployReceiptSummary(receipt));
    },
  });
}
