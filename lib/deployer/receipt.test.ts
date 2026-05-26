import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeDeployReceipt } from "./receipt.js";

describe("deploy receipts", () => {
  it("writes a durable receipt file", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-deploy-"));
    const receiptPath = await writeDeployReceipt(workspaceDir, "demo", {
      id: "r1",
      timestamp: new Date().toISOString(),
      project: "demo",
      invocation: { kind: "direct" },
      action: "promote",
      issueLinkage: "none",
      sourceLane: "build",
      targetLane: "staging",
      transitionKey: "promote:build->staging",
      candidate: { ref: "abc", source: "explicit" },
      commandId: "cmd",
      command: "echo ok",
      dryRun: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      success: true,
      evidence: ["command"],
    });
    const content = await fs.readFile(receiptPath, "utf-8");
    assert.match(content, /"transitionKey": "promote:build->staging"/);
  });
});
