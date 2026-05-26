import type { DeploymentAction, DeploymentConfig, IssueLinkageMode } from "../config/types.js";

export type DeployInvocationKind = "workflow" | "direct";

export type DeployRequest = {
  action: DeploymentAction;
  targetLane: string;
  sourceLane?: string;
  candidateRef?: string;
  dryRun?: boolean;
  issueId?: number;
  issueLinkage?: IssueLinkageMode;
  invocation: {
    kind: DeployInvocationKind;
    stateKey?: string;
  };
};

export type DeployCandidate = {
  ref: string;
  source: "explicit" | "issueCandidate" | "issuePr" | "gitHead" | "fallback";
  commitSha?: string | null;
  prUrl?: string | null;
};

export type DeployDecision = {
  action: DeploymentAction;
  sourceLane: string | null;
  targetLane: string;
  transitionKey: string;
  commandId: string;
  command: string;
  cwd?: string;
  timeoutMs: number;
  evidenceProfile?: string;
  candidate: DeployCandidate | null;
  issueLinkage: IssueLinkageMode;
};

export type DeployReceipt = {
  id: string;
  timestamp: string;
  project: string;
  issueId?: number;
  invocation: DeployRequest["invocation"];
  action: DeploymentAction;
  issueLinkage: IssueLinkageMode;
  sourceLane: string | null;
  targetLane: string;
  transitionKey: string;
  candidate: DeployCandidate | null;
  commandId: string;
  command: string;
  cwd?: string;
  dryRun: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
  evidenceProfile?: string;
  evidence: string[];
  receiptPath?: string;
  linkedIssueCommentId?: number | null;
  configSnapshot?: Pick<DeploymentConfig, "policy">;
};

export type DeployEngineResult = {
  decision: DeployDecision;
  receipt: DeployReceipt;
};
