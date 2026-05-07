import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { createTestHarness, type TestHarness } from "../testing/index.js";
import { projectTick } from "./tick.js";
import { deliveryPass } from "./heartbeat/delivery.js";
import { DEFAULT_WORKFLOW, getCompletionRule } from "../workflow/index.js";

describe("delivery phase routing", () => {
  let h: TestHarness;

  afterEach(async () => {
    if (h) await h.cleanup();
  });

  it("derives reviewer/tester completion rules from delivery active states", () => {
    const promoteRule = getCompletionRule(DEFAULT_WORKFLOW, "reviewer", "approve", "Promoting");
    const acceptRule = getCompletionRule(DEFAULT_WORKFLOW, "tester", "pass", "Accepting");

    assert.deepStrictEqual(promoteRule, {
      from: "Promoting",
      to: "To Accept",
      actions: [],
    });
    assert.deepStrictEqual(acceptRule, {
      from: "Accepting",
      to: "Done",
      actions: ["closeIssue"],
    });
  });

  it("dispatches delivery queues into their matching active states", async () => {
    h = await createTestHarness({
      workers: {
        reviewer: { active: false, issueId: null, sessionKey: null },
        tester: { active: false, issueId: null, sessionKey: null },
      },
    });

    h.provider.seedIssue({ iid: 42, title: "Promote candidate", labels: ["To Promote", "promotion:agent"] });
    h.provider.seedIssue({ iid: 43, title: "Accept candidate", labels: ["To Accept", "acceptance:agent"] });

    const reviewerTick = await projectTick({
      workspaceDir: h.workspaceDir,
      projectSlug: h.project.slug,
      provider: h.provider,
      targetRole: "reviewer",
      runCommand: h.runCommand,
    });
    const testerTick = await projectTick({
      workspaceDir: h.workspaceDir,
      projectSlug: h.project.slug,
      provider: h.provider,
      targetRole: "tester",
      runCommand: h.runCommand,
    });

    assert.strictEqual(reviewerTick.pickups.length, 1);
    assert.strictEqual(testerTick.pickups.length, 1);

    const transitions = h.provider.callsTo("transitionLabel");
    assert.deepStrictEqual(transitions.map((call) => call.args), [
      { issueId: 42, from: "To Promote", to: "Promoting" },
      { issueId: 43, from: "To Accept", to: "Accepting" },
    ]);
  });

  it("records candidate provenance when promotion is human-routed", async () => {
    h = await createTestHarness();
    h.provider.seedIssue({ iid: 44, title: "Human promote", labels: ["To Promote", "promotion:human"] });

    const transitions = await deliveryPass({
      workspaceDir: h.workspaceDir,
      projectName: h.project.slug,
      workflow: h.workflow,
      provider: h.provider,
      repoPath: h.project.repo,
      runCommand: h.runCommand,
    });

    assert.strictEqual(transitions, 1);

    const transitionCalls = h.provider.callsTo("transitionLabel");
    assert.deepStrictEqual(transitionCalls.at(-1)?.args, {
      issueId: 44,
      from: "To Promote",
      to: "To Accept",
    });

    const comments = await h.provider.listComments(44);
    assert.match(comments.at(-1)?.body ?? "", /devclaw:candidate-record/);
    assert.match(comments.at(-1)?.body ?? "", /status: active/);
  });
});
