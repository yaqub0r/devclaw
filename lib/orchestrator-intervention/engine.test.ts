import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "../testing/harness.js";
import { upsertInterventionPolicy } from "./store.js";
import { recordAndApplyInterventionEvent } from "./engine.js";

describe("orchestrator intervention engine", () => {
  it("wakes the orchestrator and executes an auto comment policy on matching review feedback", async () => {
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
        agentId: "main",
        project: h.project,
        workflow: h.workflow,
        provider: h.provider,
        issue,
        runCommand: h.runCommand,
      }, {
        eventType: "review.feedback",
        issueId: 42,
        reason: "changes_requested",
        source: "heartbeat",
      });

      assert.equal(executions.length, 1);
      assert.equal(executions[0]?.executed, true);
      assert.equal((executions[0]?.details as any)?.wake?.delivered, true);
      const comments = await h.provider.listComments(42);
      assert.equal(comments.length, 1);
      assert.match(comments[0]!.body, /Seen on #42: changes_requested/);
      const wakes = h.commands.taskMessages();
      assert.equal(wakes.length, 1);
      assert.match(wakes[0]!, /Live intervention wake for issue #42/);
      assert.match(wakes[0]!, /"eventType": "review.feedback"/);
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
        agentId: "main",
        project: h.project,
        workflow: h.workflow,
        provider: h.provider,
        issue,
        runCommand: h.runCommand,
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

  it("creates follow-up issues in the workflow initial hold state, not the first hold state by order", async () => {
    const h = await createTestHarness();
    try {
      h.workflow = {
        ...h.workflow,
        initial: "planning",
        states: {
          refining: { label: "Refining", type: "HOLD", description: "later hold" },
          planning: { label: "Planning", type: "HOLD", description: "initial hold" },
          todo: h.workflow.states.todo,
          doing: h.workflow.states.doing,
          done: h.workflow.states.done,
        },
      } as any;
      const issue = h.provider.seedIssue({ iid: 88, title: "Needs follow-up", labels: ["Doing"] });
      await upsertInterventionPolicy(h.workspaceDir, h.project.slug, {
        id: "create-followup",
        title: "Create follow-up",
        mode: "auto",
        issueId: 88,
        event: { type: "worker.completed", result: "done" },
        action: { type: "create_followup", title: "Follow-up for #{{issueId}}", body: "Body" },
      });

      const executions = await recordAndApplyInterventionEvent({
        workspaceDir: h.workspaceDir,
        channelId: h.channelId,
        agentId: "main",
        project: h.project,
        workflow: h.workflow,
        provider: h.provider,
        issue,
        runCommand: h.runCommand,
      }, {
        eventType: "worker.completed",
        issueId: 88,
        result: "done",
        source: "worker",
      });

      assert.equal(executions[0]?.executed, true);
      const createdIssueId = Number((executions[0]?.details as any)?.createdIssueId);
      const created = await h.provider.getIssue(createdIssueId);
      assert.ok(created.labels.includes("Planning"));
      assert.ok(!created.labels.includes("Refining"));
    } finally {
      await h.cleanup();
    }
  });
});
