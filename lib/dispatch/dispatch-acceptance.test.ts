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
      iid: 201,
      title: "Research worker launch",
      labels: ["To Do"],
    });
    const runtime = {
      gateway: {
        async request() {
          throw new Error("gateway.request must not be called");
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
        issueId: 201,
        issueTitle: "Research worker launch",
        issueDescription: "Validate rollback",
        issueUrl: "https://example.invalid/issues/201",
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

    const issue = await harness.provider.getIssue(201);
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
      iid: 202,
      title: "Reusable worker session",
      labels: ["To Do"],
    });
    const runSessionKeys: string[] = [];
    const runMessages: string[] = [];
    const sessionPatches: Array<Record<string, unknown>> = [];
    const runtime = {
      gateway: {
        async request() {
          throw new Error("gateway.request must not be called");
        },
      },
      agent: {
        session: {
          async patchSessionEntry(params: {
            update: (entry: Record<string, unknown>) => Record<string, unknown>;
          } & Record<string, unknown>) {
            sessionPatches.push({
              ...params,
              update: params.update({}),
            });
            return {};
          },
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
      issueId: 202,
      issueTitle: "Reusable worker session",
      issueDescription: "Initial pass",
      issueUrl: "https://example.invalid/issues/202",
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
    await harness.provider.transitionLabel(202, "Doing", "To Improve");
    const returningProject = getProject(await harness.readProjects(), harness.channelId)!;
    const returningSlot = getRoleWorker(returningProject, "developer").levels.medior?.[0];
    assert.equal(returningSlot?.sessionKey, first.sessionKey);
    assert.equal(returningSlot?.lastIssueId, "202");

    const second = await dispatchTask({
      workspaceDir: harness.workspaceDir,
      agentId: "devclaw",
      project: returningProject,
      issueId: 202,
      issueTitle: "Reusable worker session",
      issueDescription: "Feedback pass",
      issueUrl: "https://example.invalid/issues/202",
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

    assert.equal(sessionPatches.length, 2);
    assert.equal(
      sessionPatches.every((call) =>
        (call.update as Record<string, unknown>).spawnedBy ===
        `agent:devclaw:telegram:group:${harness!.channelId}:topic:176`),
      true,
    );
  });

  it("rolls the issue back when the host rejects its model override", async () => {
    harness = await createTestHarness();
    harness.provider.seedIssue({
      iid: 203,
      title: "Unavailable worker model",
      labels: ["To Do"],
    });
    let runCalled = false;
    const runtime = {
      gateway: {
        async request() {
          throw new Error("gateway.request must not be called");
        },
      },
      subagent: {
        async run(params: Record<string, unknown>) {
          runCalled = true;
          assert.equal(typeof params.provider, "string");
          assert.equal(typeof params.model, "string");
          throw new Error("provider/model override is not authorized for this plugin subagent run.");
        },
      },
    } as unknown as PluginRuntime;

    await assert.rejects(
      dispatchTask({
        workspaceDir: harness.workspaceDir,
        agentId: "devclaw",
        project: harness.project,
        issueId: 203,
        issueTitle: "Unavailable worker model",
        issueDescription: "Do not remove this issue from its queue.",
        issueUrl: "https://example.invalid/issues/203",
        role: "developer",
        level: "medior",
        fromLabel: "To Do",
        toLabel: "Doing",
        provider: harness.provider,
        runCommand: harness.runCommand,
        runtime,
      }),
      /provider\/model override is not authorized/,
    );

    const issue = await harness.provider.getIssue(203);
    assert.equal(issue.labels.includes("To Do"), true);
    assert.equal(issue.labels.includes("Doing"), false);
    assert.equal(runCalled, true);
  });
});
