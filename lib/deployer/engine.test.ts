import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDeployEngine } from "./engine.js";
import { runWorkflowDeployment } from "./workflow.js";
import { TestProvider } from "../testing/test-provider.js";
import type { DeploymentConfig } from "../config/types.js";

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
  candidate: { sources: ["explicit"] },
  policy: { allowDirectWithoutIssue: true },
};

describe("deploy engine", () => {
  it("returns normalized receipt fields for direct and workflow runs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-deploy-engine-"));
    const provider = new TestProvider();
    provider.seedIssue({ iid: 7, labels: ["Promoting"] });
    const runCommand = async () => ({ stdout: "ok\n", stderr: "", code: 0, signal: null, killed: false as const });
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
    assert.equal(workflow.receipt.issueLinkage, "workflow");
    assert.ok(workflow.receipt.linkedIssueCommentId);
  });
});
