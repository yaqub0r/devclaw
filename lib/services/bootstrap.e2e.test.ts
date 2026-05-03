/**
 * E2E bootstrap tests.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { createTestHarness, type TestHarness } from "../testing/index.js";
import { dispatchTask } from "../dispatch/index.js";

describe("E2E bootstrap — extraSystemPrompt injection", () => {
  let h: TestHarness;

  afterEach(async () => {
    if (h) await h.cleanup();
  });

  it("should inject project-specific instructions via extraSystemPrompt", async () => {
    h = await createTestHarness({ projectName: "my-app" });
    h.provider.seedIssue({ iid: 1, title: "Add feature", labels: ["To Do"] });
    await h.writePrompt("developer", "# Default Developer\nGeneric instructions.");
    await h.writePrompt("developer", "# My App Developer\nUse React. Follow our design system.", "my-app");

    await dispatchTask({
      workspaceDir: h.workspaceDir,
      agentId: "main",
      project: h.project,
      issueId: 1,
      issueTitle: "Add feature",
      issueDescription: "",
      issueUrl: "https://example.com/issues/1",
      role: "developer",
      level: "medior",
      fromLabel: "To Do",
      toLabel: "Doing",
      provider: h.provider,
      runCommand: h.runCommand,
    });

    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 1);
    assert.ok(prompts[0].includes("My App Developer"));
    assert.ok(!prompts[0].includes("Generic instructions"));
  });
});

describe("E2E bootstrap — agent:bootstrap hook", () => {
  let h: TestHarness;

  afterEach(async () => {
    if (h) await h.cleanup();
  });

  it("should keep worker bootstrap scoped to AGENTS.md only", async () => {
    h = await createTestHarness({ projectName: "my-app" });
    const result = await h.simulateBootstrap("agent:main:subagent:my-app-developer-medior-Ada");
    assert.ok(result.agentsContent);
    assert.ok(!result.agentsContent?.includes("Orchestrator instructions"));
    assert.ok(!result.bootstrapFileNames.includes("orchestrator.md"));
  });

  it("should inject the project-specific orchestrator prompt into a real chat-backed orchestrator session", async () => {
    h = await createTestHarness({ projectName: "my-app", channelId: "-1000000000001", messageThreadId: 42 });
    await h.writePrompt("orchestrator", "# My App Orchestrator\nUse the app-specific workflow.", "my-app");
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000001:topic:42", {
      channelId: "-1000000000001",
      channel: "telegram",
      messageThreadId: 42,
    });

    assert.strictEqual(result.agentsMdStripped, false);
    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("My App Orchestrator"));
    assert.ok(!result.orchestratorContent?.includes("Generic workflow"));
  });

  it("should resolve the project-specific orchestrator prompt from the real session key when bootstrap context omits chat scope", async () => {
    h = await createTestHarness({ projectName: "firstlight", channelId: "-1000000000002", messageThreadId: 99 });
    await h.writePrompt("orchestrator", "project-marker\nproject-step", "firstlight");
    await h.writePrompt("orchestrator", "workspace-marker\nworkspace-step");

    const result = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:99", {
      channel: "telegram",
    });

    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("project-marker"));
    assert.ok(result.orchestratorContent?.includes("project-step"));
    assert.ok(!result.orchestratorContent?.includes("workspace-marker"));
  });

  it("should replace stale orchestrator.md content across repeated fresh bootstrap runs on the same topic key", async () => {
    h = await createTestHarness({ projectName: "firstlight", channelId: "-1000000000002", messageThreadId: 7 });
    const projectPrompt = path.join(h.workspaceDir, "devclaw", "projects", "firstlight", "prompts", "orchestrator.md");
    const workspacePrompt = path.join(h.workspaceDir, "devclaw", "prompts", "orchestrator.md");

    await h.writePrompt("orchestrator", "workspace-marker\nworkspace-step");
    await h.writePrompt("orchestrator", "project-marker\nproject-step", "firstlight");

    const first = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
    });
    assert.ok(first.orchestratorContent?.includes("project-marker"));
    assert.ok(first.orchestratorContent?.includes("project-step"));

    await fs.rm(projectPrompt);
    const second = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
      bootstrapFiles: first.bootstrapFiles,
    });
    assert.ok(second.orchestratorContent?.includes("workspace-marker"));
    assert.ok(second.orchestratorContent?.includes("workspace-step"));
    assert.ok(!second.orchestratorContent?.includes("project-marker"));
    assert.ok(!second.orchestratorContent?.includes("project-step"));

    await fs.writeFile(projectPrompt, "project-marker-v2\nproject-step-v2", "utf-8");
    const third = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
      bootstrapFiles: second.bootstrapFiles,
    });
    assert.ok(third.orchestratorContent?.includes("project-marker-v2"));
    assert.ok(third.orchestratorContent?.includes("project-step-v2"));
    assert.ok(!third.orchestratorContent?.includes("workspace-marker"));
    assert.ok(!third.orchestratorContent?.includes("workspace-step"));

    await fs.writeFile(workspacePrompt, "workspace-marker-v2\nworkspace-step-v2", "utf-8");
    await fs.rm(projectPrompt);
    const fourth = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
      bootstrapFiles: third.bootstrapFiles,
    });
    assert.ok(fourth.orchestratorContent?.includes("workspace-marker-v2"));
    assert.ok(fourth.orchestratorContent?.includes("workspace-step-v2"));
    assert.ok(!fourth.orchestratorContent?.includes("project-marker-v2"));
    assert.ok(!fourth.orchestratorContent?.includes("project-step-v2"));
  });

  it("should NOT inject orchestrator.md for non-main, non-worker sessions", async () => {
    h = await createTestHarness();
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:main:orchestrator", {
      channelId: h.channelId,
      channel: "telegram",
    });

    assert.strictEqual(result.agentsMdStripped, false);
    assert.ok(!result.bootstrapFileNames.includes("orchestrator.md"));
  });
});
