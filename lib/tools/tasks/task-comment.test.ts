/**
 * Tests for task_comment dispatch-status output tracking.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { createTestHarness } from "../../testing/index.js";
import { createTaskCommentTool } from "./task-comment.js";
import { upsertDispatchStatus, getDispatchStatus } from "../../services/dispatch-status.js";

describe("task_comment dispatch status", () => {
  it("records worker output when a session-backed worker comment succeeds", async () => {
    const h = await createTestHarness();
    try {
      h.provider.seedIssue({ iid: 64, title: "Research issue", labels: ["Researching"] });
      await upsertDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 64, role: "architect" }, {
        projectName: h.project.name,
        level: "senior",
        sessionKey: "sess-64",
        sessionAction: "spawn",
        labelMovedAt: new Date().toISOString(),
      });

      const tool = createTaskCommentTool({ runCommand: h.runCommand } as any)({
        workspaceDir: h.workspaceDir,
        sessionKey: "sess-64",
        agentId: "devclaw",
      });
      await tool.execute("1", {
        channelId: h.channelId,
        issueId: 64,
        body: "Findings posted",
        authorRole: "architect",
      });

      const status = await getDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 64, role: "architect" });
      assert.ok(status?.firstWorkerOutputAt);
      assert.strictEqual(status?.firstWorkerOutputKind, "comment");
      assert.ok(status?.lastWorkerOutputAt);
    } finally {
      await h.cleanup();
    }
  });

  it("records comment-post failures before rethrowing", async () => {
    const h = await createTestHarness();
    try {
      h.provider.seedIssue({ iid: 65, title: "Research issue", labels: ["Researching"] });
      await upsertDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 65, role: "architect" }, {
        projectName: h.project.name,
        level: "senior",
        sessionKey: "sess-65",
        sessionAction: "spawn",
        labelMovedAt: new Date().toISOString(),
      });
      h.provider.addComment = async () => { throw new Error("tracker write failed"); };

      const tool = createTaskCommentTool({ runCommand: h.runCommand } as any)({
        workspaceDir: h.workspaceDir,
        sessionKey: "sess-65",
        agentId: "devclaw",
      });

      await assert.rejects(() => tool.execute("1", {
        channelId: h.channelId,
        issueId: 65,
        body: "Findings posted",
        authorRole: "architect",
      }), /tracker write failed/);

      const status = await getDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 65, role: "architect" });
      assert.ok(status?.lastCommentPostFailedAt);
      assert.match(status?.lastCommentPostError ?? "", /tracker write failed/);
    } finally {
      await h.cleanup();
    }
  });
});
