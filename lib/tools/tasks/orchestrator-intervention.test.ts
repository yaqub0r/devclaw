import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "../../testing/harness.js";
import { createOrchestratorInterventionTool } from "./orchestrator-intervention.js";

const pluginCtx = {
  runCommand: (() => Promise.resolve({ stdout: "{}", stderr: "", code: 0, signal: null, killed: false })) as any,
  runtime: {} as any,
  pluginConfig: {},
  config: {} as any,
  logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
};

describe("orchestrator_intervention tool", () => {
  it("saves and lists policies", async () => {
    const h = await createTestHarness();
    try {
      const tool = createOrchestratorInterventionTool(pluginCtx as any)({
        workspaceDir: h.workspaceDir,
        messageChannel: "telegram",
      });

      await tool.execute("1", {
        channelId: h.channelId,
        action: "set_policy",
        policy: {
          title: "Requeue blocked dev",
          event: { type: "workflow.hold", role: "developer", result: "blocked" },
          action: { type: "requeue", message: "Try again" },
        },
      });

      const listed = await tool.execute("2", {
        channelId: h.channelId,
        action: "list_policies",
      });

      const details = listed.details as { policies: Array<{ title: string }> };
      assert.equal(details.policies.length, 1);
      assert.equal(details.policies[0]?.title, "Requeue blocked dev");
    } finally {
      await h.cleanup();
    }
  });
});
