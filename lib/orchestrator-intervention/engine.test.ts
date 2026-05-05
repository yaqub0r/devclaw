import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "../testing/harness.js";
import { upsertInterventionPolicy } from "./store.js";
import { recordAndApplyInterventionEvent } from "./engine.js";

describe("orchestrator intervention engine", () => {
  it("executes an auto comment policy on matching review feedback", async () => {
    const h = await createTestHarness();
    try {
      const issue = h.provider.seedIssue({ iid: 42, title: "Needs follow-up", labels: ["Refining"] });
      await upsertInterventionPolicy(h.workspaceDir, h.project.slug, {
        id: "comment-on-feedback",
        title: "Comment on feedback",
        mode: "auto",
        event: { type: "review.feedback", reason: "changes_requested" },
        action: { type: "comment", message: "Seen on #{{issueId}}: {{reason}}" },
      });

      const executions = await recordAndApplyInterventionEvent({
        workspaceDir: h.workspaceDir,
        channelId: h.channelId,
        project: h.project,
        workflow: h.workflow,
        provider: h.provider,
        issue,
      }, {
        eventType: "review.feedback",
        issueId: 42,
        reason: "changes_requested",
        source: "heartbeat",
      });

      assert.equal(executions.length, 1);
      assert.equal(executions[0]?.executed, true);
      const comments = await h.provider.listComments(42);
      assert.equal(comments.length, 1);
      assert.match(comments[0]!.body, /Seen on #42: changes_requested/);
    } finally {
      await h.cleanup();
    }
  });

  it("requeues a refining issue when a hold policy matches", async () => {
    const h = await createTestHarness();
    try {
      const issue = h.provider.seedIssue({ iid: 77, title: "Blocked", labels: ["Refining"] });
      await upsertInterventionPolicy(h.workspaceDir, h.project.slug, {
        id: "requeue-blocked",
        title: "Requeue blocked issues",
        mode: "auto",
        issueId: 77,
        event: { type: "workflow.hold", result: "blocked" },
        action: { type: "requeue", message: "Requeued after {{result}}" },
      });

      const executions = await recordAndApplyInterventionEvent({
        workspaceDir: h.workspaceDir,
        channelId: h.channelId,
        project: h.project,
        workflow: h.workflow,
        provider: h.provider,
        issue,
      }, {
        eventType: "workflow.hold",
        issueId: 77,
        result: "blocked",
        fromState: "Doing",
        toState: "Refining",
        source: "worker",
      });

      assert.equal(executions[0]?.executed, true);
      const updated = await h.provider.getIssue(77);
      assert.ok(updated.labels.includes("To Do"));
      const comments = await h.provider.listComments(77);
      assert.equal(comments.length, 1);
      assert.match(comments[0]!.body, /Requeued after blocked/);
    } finally {
      await h.cleanup();
    }
  });
});
