import type { Project } from "../projects/index.js";
import type { RunCommand } from "../context.js";
import type { DeploymentConfig } from "../config/types.js";
import type { IssueProvider } from "../providers/provider.js";
import { writeDeployReceipt } from "./receipt.js";
import { resolveDeployDecision } from "./resolve.js";
import type { DeployEngineResult, DeployReceipt, DeployReceiptFinalizer, DeployRequest } from "./types.js";

function buildDeployEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, value]));
}

export async function runDeployEngine(opts: {
  workspaceDir: string;
  project: Project;
  repoPath: string;
  config: DeploymentConfig;
  request: DeployRequest;
  runCommand: RunCommand;
  provider?: IssueProvider;
  finalizeReceipt?: DeployReceiptFinalizer;
}): Promise<DeployEngineResult> {
  const decision = await resolveDeployDecision({
    request: opts.request,
    config: opts.config,
    project: opts.project,
    provider: opts.provider,
    repoPath: opts.repoPath,
    runCommand: opts.runCommand,
  });

  const vars = {
    ACTION: decision.action,
    SOURCE_LANE: decision.sourceLane ?? "",
    TARGET_LANE: decision.targetLane,
    CANDIDATE_REF: decision.candidate?.ref ?? "",
    ISSUE_ID: String(opts.request.issueId ?? ""),
    PROJECT: opts.project.name,
  };

  const command = decision.command;
  const commandEnv = buildDeployEnv(vars);
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  if (!opts.request.dryRun) {
    const result = await opts.runCommand(["bash", "-lc", command], {
      cwd: decision.cwd ?? opts.repoPath,
      timeoutMs: decision.timeoutMs,
      env: commandEnv,
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
    exitCode = result.code ?? 0;
  }

  const receipt: DeployReceipt = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    project: opts.project.name,
    issueId: opts.request.issueId,
    invocation: opts.request.invocation,
    action: decision.action,
    issueLinkage: decision.issueLinkage,
    sourceLane: decision.sourceLane,
    targetLane: decision.targetLane,
    transitionKey: decision.transitionKey,
    candidate: decision.candidate,
    commandId: decision.commandId,
    command,
    cwd: decision.cwd ?? opts.repoPath,
    dryRun: !!opts.request.dryRun,
    exitCode,
    stdout,
    stderr,
    success: exitCode === 0,
    evidenceProfile: decision.evidenceProfile,
    evidence: opts.config.evidenceProfiles?.[decision.evidenceProfile ?? ""]?.required ?? [],
    configSnapshot: { policy: opts.config.policy },
  };

  if (opts.finalizeReceipt) {
    await opts.finalizeReceipt(receipt);
  }

  receipt.receiptPath = await writeDeployReceipt(opts.workspaceDir, opts.project.name, receipt);
  return { decision, receipt };
}
