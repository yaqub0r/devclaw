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
  it("saves and lists safe policies", async () => {
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
          title: "Comment on blocked dev",
          event: { type: "workflow.hold", role: "developer", result: "blocked" },
          action: { type: "comment", message: "Need human decision" },
        },
      });

      const listed = await tool.execute("2", {
        channelId: h.channelId,
        action: "list_policies",
      });

      const details = listed.details as { policies: Array<{ title: string }> };
      assert.equal(details.policies.length, 1);
      assert.equal(details.policies[0]?.title, "Comment on blocked dev");
    } finally {
      await h.cleanup();
    }
  });

  it("rejects auto requeue policies for hold events", async () => {
    const h = await createTestHarness();
    try {
      const tool = createOrchestratorInterventionTool(pluginCtx as any)({
        workspaceDir: h.workspaceDir,
        messageChannel: "telegram",
      });

      await assert.rejects(
        tool.execute("1", {
          channelId: h.channelId,
          action: "set_policy",
          policy: {
            title: "Requeue blocked dev",
            event: { type: "workflow.hold", role: "developer", result: "blocked" },
            action: { type: "requeue", message: "Try again" },
          },
        }),
        /not allowed for workflow\.hold policies/,
      );
    } finally {
      await h.cleanup();
    }
  });

  it("rejects auto queue_issue policies for hold events", async () => {
    const h = await createTestHarness();
    try {
      const tool = createOrchestratorInterventionTool(pluginCtx as any)({
        workspaceDir: h.workspaceDir,
        messageChannel: "telegram",
      });

      await assert.rejects(
        tool.execute("1", {
          channelId: h.channelId,
          action: "set_policy",
          policy: {
            title: "Queue blocked dev",
            event: { type: "workflow.hold", role: "developer", result: "blocked" },
            action: { type: "queue_issue", issueId: 42 },
          },
        }),
        /not allowed for workflow\.hold policies/,
      );
    } finally {
      await h.cleanup();
    }
  });
});
