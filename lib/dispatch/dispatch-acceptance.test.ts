import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import { deactivateWorker, getProject, getRoleWorker } from "../projects/index.js";
import { createTestHarness, type TestHarness } from "../testing/index.js";
import { dispatchTask } from "./index.js";

describe("dispatch launch acceptance", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("rolls the issue back and leaves the worker inactive when launch is rejected", async () => {
    harness = await createTestHarness();
    harness.provider.seedIssue({
      iid: 902,
      title: "Research worker launch",
      labels: ["To Do"],
    });
    const runtime = {
      gateway: {
        async request() {
          return {};
        },
      },
      subagent: {
        async run() {
          throw new Error("gateway rejected subagent launch");
        },
      },
    } as unknown as PluginRuntime;

    await assert.rejects(
      dispatchTask({
        workspaceDir: harness.workspaceDir,
        agentId: "devclaw",
        project: harness.project,
        issueId: 902,
        issueTitle: "Research worker launch",
        issueDescription: "Validate rollback",
        issueUrl: "https://example.com/issues/902",
        role: "developer",
        level: "medior",
        fromLabel: "To Do",
        toLabel: "Doing",
        provider: harness.provider,
        runCommand: harness.runCommand,
        runtime,
      }),
      /gateway rejected subagent launch/,
    );

    const issue = await harness.provider.getIssue(902);
    assert.equal(issue.labels.includes("To Do"), true);
    assert.equal(issue.labels.includes("Doing"), false);
    assert.equal(issue.labels.some((label) => label.startsWith("developer:")), false);

    const projects = await harness.readProjects();
    const project = getProject(projects, harness.channelId);
    assert.ok(project);
    const slot = getRoleWorker(project, "developer").levels.medior?.[0];
    assert.equal(slot?.active ?? false, false);
    assert.equal(slot?.issueId ?? null, null);
    assert.equal(slot?.sessionKey ?? null, null);
  });

  it("reuses the deterministic plugin-owned session for a returning issue", async () => {
    harness = await createTestHarness({ messageThreadId: 176 });
    harness.provider.seedIssue({
      iid: 903,
      title: "Reusable worker session",
      labels: ["To Do"],
    });
    const runSessionKeys: string[] = [];
    const runMessages: string[] = [];
    const gatewayCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const runtime = {
      gateway: {
        async request(method: string, params?: Record<string, unknown>) {
          gatewayCalls.push({ method, params });
          return {};
        },
      },
      subagent: {
        async run(params: { sessionKey: string; message: string }) {
          runSessionKeys.push(params.sessionKey);
          runMessages.push(params.message);
          return { runId: `run-${runSessionKeys.length}` };
        },
      },
    } as unknown as PluginRuntime;

    const first = await dispatchTask({
      workspaceDir: harness.workspaceDir,
      agentId: "devclaw",
      project: harness.project,
      issueId: 903,
      issueTitle: "Reusable worker session",
      issueDescription: "Initial pass",
      issueUrl: "https://example.com/issues/903",
      role: "developer",
      level: "medior",
      fromLabel: "To Do",
      toLabel: "Doing",
      provider: harness.provider,
      runCommand: harness.runCommand,
      runtime,
    });
    assert.equal(first.sessionAction, "spawn");
    assert.equal(first.runId, "run-1");

    await deactivateWorker(
      harness.workspaceDir,
      harness.project.slug,
      "developer",
      { level: "medior", slotIndex: 0 },
    );
    await harness.provider.transitionLabel(903, "Doing", "To Improve");
    const returningProject = getProject(await harness.readProjects(), harness.channelId)!;
    const returningSlot = getRoleWorker(returningProject, "developer").levels.medior?.[0];
    assert.equal(returningSlot?.sessionKey, first.sessionKey);
    assert.equal(returningSlot?.lastIssueId, "903");

    const second = await dispatchTask({
      workspaceDir: harness.workspaceDir,
      agentId: "devclaw",
      project: returningProject,
      issueId: 903,
      issueTitle: "Reusable worker session",
      issueDescription: "Feedback pass",
      issueUrl: "https://example.com/issues/903",
      role: "developer",
      level: "medior",
      fromLabel: "To Improve",
      toLabel: "Doing",
      provider: harness.provider,
      runCommand: harness.runCommand,
      runtime,
    });

    assert.equal(second.sessionAction, "send");
    assert.equal(second.sessionKey, first.sessionKey);
    assert.equal(second.runId, "run-2");
    assert.deepEqual(runSessionKeys, [first.sessionKey, first.sessionKey]);
    assert.equal(runMessages.every((message) =>
      message.includes(`"messageThreadId": 176`)), true);

    const sessionPatches = gatewayCalls.filter((call) => call.method === "sessions.patch");
    assert.equal(sessionPatches.length, 2);
    assert.equal(
      sessionPatches.every((call) =>
        call.params?.spawnedBy ===
        `agent:devclaw:telegram:group:${harness!.channelId}:topic:176`),
      true,
    );
  });

  it("leaves the issue untouched when the configured catalog excludes its model", async () => {
    harness = await createTestHarness();
    harness.provider.seedIssue({
      iid: 904,
      title: "Unavailable worker model",
      labels: ["To Do"],
    });
    let runCalled = false;
    const runtime = {
      gateway: {
        async request(method: string) {
          assert.equal(method, "models.list");
          return {
            models: [{ provider: "google", id: "gemini-3-pro" }],
          };
        },
      },
      subagent: {
        async run() {
          runCalled = true;
          return { runId: "unexpected" };
        },
      },
    } as unknown as PluginRuntime;

    await assert.rejects(
      dispatchTask({
        workspaceDir: harness.workspaceDir,
        agentId: "devclaw",
        project: harness.project,
        issueId: 904,
        issueTitle: "Unavailable worker model",
        issueDescription: "Do not remove this issue from its queue.",
        issueUrl: "https://example.com/issues/904",
        role: "developer",
        level: "medior",
        fromLabel: "To Do",
        toLabel: "Doing",
        provider: harness.provider,
        runCommand: harness.runCommand,
        runtime,
      }),
      /Configured model unavailable/,
    );

    const issue = await harness.provider.getIssue(904);
    assert.equal(issue.labels.includes("To Do"), true);
    assert.equal(issue.labels.includes("Doing"), false);
    assert.equal(runCalled, false);
  });
});
