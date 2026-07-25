import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDeployEngine } from "./engine.js";
import { runWorkflowDeployment } from "./workflow.js";
import { TestProvider } from "../testing/test-provider.js";
import type { DeploymentConfig } from "../config/types.js";
import { renderCandidateRecord } from "../workflow/candidate-provenance.js";

const deployment: DeploymentConfig = {
  lanes: {
    build: { aliases: ["candidate"] },
    staging: { aliases: ["stage"], rollbackTargets: ["build"] },
  },
  commands: {
    promote: { run: 'echo "promote ${CANDIDATE_REF} ${SOURCE_LANE} ${TARGET_LANE}"' },
  },
  evidenceProfiles: {
    proof: { required: ["command", "candidate"], commentSummary: true },
  },
  transitions: [
    { action: "promote", from: "build", to: "staging", command: "promote", evidence: "proof" },
  ],
  workflow: {
    states: {
      promoting: { action: "promote", sourceLane: "build", targetLane: "staging", issueLinkage: "workflow" },
    },
  },
  candidate: { sources: ["explicit", "issueCandidate"] },
  policy: { allowDirectWithoutIssue: true },
};

describe("deploy engine", () => {
  it("returns normalized receipt fields for direct and workflow runs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-deploy-engine-"));
    const provider = new TestProvider();
    provider.seedIssue({ iid: 7, labels: ["Promoting"] });
    await provider.addComment(7, renderCandidateRecord({
      issueId: 7,
      candidateId: "sha123",
      commitSha: "sha123",
      status: "active",
    }));
    let executedCommand: string[] | undefined;
    let executedEnv: Record<string, string> | undefined;
    const runCommand = async (argv: string[], opts?: { env?: Record<string, string> }) => {
      executedCommand = argv;
      executedEnv = opts?.env;
      return { stdout: "ok\n", stderr: "", code: 0, signal: null, killed: false as const };
    };
    const project = { name: "demo", deployBranch: "main", deployUrl: "", repo: "/tmp/repo" } as any;

    const direct = await runDeployEngine({
      workspaceDir,
      project,
      repoPath: "/tmp/repo",
      config: deployment,
      provider,
      runCommand: runCommand as any,
      request: {
        action: "promote",
        sourceLane: "build",
        targetLane: "staging",
        candidateRef: "sha123",
        issueId: 7,
        issueLinkage: "comment",
        invocation: { kind: "direct" },
      },
    });

    const workflow = await runWorkflowDeployment({
      workspaceDir,
      project,
      repoPath: "/tmp/repo",
      provider,
      issueId: 7,
      currentStateKey: "promoting",
      config: deployment,
      runCommand: runCommand as any,
    });

    assert.equal(direct.receipt.action, workflow.receipt.action);
    assert.equal(direct.receipt.targetLane, workflow.receipt.targetLane);
    assert.equal(direct.receipt.transitionKey, workflow.receipt.transitionKey);
    assert.equal(direct.receipt.candidate?.ref, "sha123");
    assert.equal(workflow.receipt.candidate?.ref, "sha123");
    assert.equal(workflow.receipt.issueLinkage, "workflow");
    assert.ok(workflow.receipt.linkedIssueCommentId);
    assert.ok(direct.receipt.receiptPath);
    assert.equal(direct.receipt.linkedIssueCommentId, undefined);
    assert.equal(executedCommand?.[2], 'echo "promote ${CANDIDATE_REF} ${SOURCE_LANE} ${TARGET_LANE}"');
    assert.equal(executedEnv?.CANDIDATE_REF, "sha123");
  });

  it("persists linked issue comment ids into the durable receipt", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-deploy-receipt-"));
    const provider = new TestProvider();
    provider.seedIssue({ iid: 9, labels: ["Promoting"] });
    await provider.addComment(9, renderCandidateRecord({
      issueId: 9,
      candidateId: "sha123",
      commitSha: "sha123",
      status: "active",
    }));
    const project = { name: "demo", deployBranch: "main", deployUrl: "", repo: "/tmp/repo" } as any;

    const result = await runWorkflowDeployment({
      workspaceDir,
      project,
      repoPath: "/tmp/repo",
      provider,
      issueId: 9,
      currentStateKey: "promoting",
      config: deployment,
      runCommand: (async () => ({ stdout: "ok\n", stderr: "", code: 0, signal: null, killed: false as const })) as any,
    });

    const persisted = JSON.parse(await fs.readFile(result.receipt.receiptPath!, "utf-8"));
    assert.equal(persisted.linkedIssueCommentId, result.receipt.linkedIssueCommentId);
    assert.ok(persisted.linkedIssueCommentId);
  });

  it("passes dynamic deploy values via env instead of interpolating them into the shell program", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-deploy-escape-"));
    let executed: string[] | undefined;
    let executedEnv: Record<string, string> | undefined;
    const project = { name: "demo", deployBranch: "main", deployUrl: "", repo: "/tmp/repo" } as any;

    await runDeployEngine({
      workspaceDir,
      project,
      repoPath: "/tmp/repo",
      config: deployment,
      runCommand: (async (argv: string[], opts?: { env?: Record<string, string> }) => {
        executed = argv;
        executedEnv = opts?.env;
        return { stdout: "ok\n", stderr: "", code: 0, signal: null, killed: false as const };
      }) as any,
      request: {
        action: "promote",
        sourceLane: "build",
        targetLane: "staging",
        candidateRef: "bad'; touch /tmp/pwned; echo '",
        invocation: { kind: "direct" },
      },
    });

    assert.ok(executed);
    assert.equal(executed?.[2], 'echo "promote ${CANDIDATE_REF} ${SOURCE_LANE} ${TARGET_LANE}"');
    assert.equal(executedEnv?.CANDIDATE_REF, "bad'; touch /tmp/pwned; echo '");
  });
});
