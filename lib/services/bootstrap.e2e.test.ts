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

  it("should fall back to default instructions when no project override exists", async () => {
    h = await createTestHarness({ projectName: "other-app" });
    h.provider.seedIssue({ iid: 2, title: "Fix bug", labels: ["To Do"] });

    // Only write default prompt, no project-specific
    await h.writePrompt("developer", "# Default Developer\nFollow coding standards.");

    await dispatchTask({
      workspaceDir: h.workspaceDir,
      agentId: "main",
      project: h.project,
      issueId: 2,
      issueTitle: "Fix bug",
      issueDescription: "",
      issueUrl: "https://example.com/issues/2",
      role: "developer",
      level: "junior",
      fromLabel: "To Do",
      toLabel: "Doing",
      provider: h.provider,
      runCommand: h.runCommand,
    });

    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 1);
    assert.ok(prompts[0].includes("Default Developer"));
    assert.ok(prompts[0].includes("Follow coding standards"));
  });

  it("should inject scaffolded default instructions when no overrides exist", async () => {
    h = await createTestHarness({ projectName: "bare-app" });
    h.provider.seedIssue({ iid: 3, title: "Chore", labels: ["To Do"] });

    await dispatchTask({
      workspaceDir: h.workspaceDir,
      agentId: "main",
      project: h.project,
      issueId: 3,
      issueTitle: "Chore",
      issueDescription: "",
      issueUrl: "https://example.com/issues/3",
      role: "developer",
      level: "medior",
      fromLabel: "To Do",
      toLabel: "Doing",
      provider: h.provider,
      runCommand: h.runCommand,
    });

    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 0, "No extraSystemPrompt when no prompt files exist");
  });

  it("should resolve tester instructions independently from developer", async () => {
    h = await createTestHarness({ projectName: "multi-role" });
    h.provider.seedIssue({ iid: 4, title: "Test thing", labels: ["To Test"] });

    await h.writePrompt("developer", "# Dev for multi-role\nSpecific dev rules.", "multi-role");
    await h.writePrompt("tester", "# Default Tester\nRun integration tests.");

    await dispatchTask({
      workspaceDir: h.workspaceDir,
      agentId: "main",
      project: h.project,
      issueId: 4,
      issueTitle: "Test thing",
      issueDescription: "",
      issueUrl: "https://example.com/issues/4",
      role: "tester",
      level: "medior",
      fromLabel: "To Test",
      toLabel: "Testing",
      provider: h.provider,
      runCommand: h.runCommand,
    });

    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 1);
    assert.ok(prompts[0].includes("Default Tester"));
    assert.ok(!prompts[0].includes("Dev for multi-role"));
  });

  it("should handle project names with hyphens correctly", async () => {
    h = await createTestHarness({ projectName: "my-cool-project" });
    h.provider.seedIssue({ iid: 5, title: "Hyphen test", labels: ["To Do"] });

    await h.writePrompt(
      "developer",
      "# Hyphenated Project\nThis project has hyphens in the name.",
      "my-cool-project",
    );

    await dispatchTask({
      workspaceDir: h.workspaceDir,
      agentId: "main",
      project: h.project,
      issueId: 5,
      issueTitle: "Hyphen test",
      issueDescription: "",
      issueUrl: "https://example.com/issues/5",
      role: "developer",
      level: "senior",
      fromLabel: "To Do",
      toLabel: "Doing",
      provider: h.provider,
      runCommand: h.runCommand,
    });

    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 1);
    assert.ok(prompts[0].includes("Hyphenated Project"));
  });

  it("should resolve architect instructions with project override", async () => {
    h = await createTestHarness({ projectName: "arch-proj" });
    h.provider.seedIssue({ iid: 6, title: "Design API", labels: ["Planning"] });

    await h.writePrompt("architect", "# Default Architect\nGeneral design guidelines.");
    await h.writePrompt("architect", "# Arch Proj Architect\nUse event-driven architecture.", "arch-proj");

    await dispatchTask({
      workspaceDir: h.workspaceDir,
      agentId: "main",
      project: h.project,
      issueId: 6,
      issueTitle: "Design API",
      issueDescription: "",
      issueUrl: "https://example.com/issues/6",
      role: "architect",
      level: "senior",
      fromLabel: "Planning",
      toLabel: "Planning",
      provider: h.provider,
      runCommand: h.runCommand,
    });

    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 1);
    assert.ok(prompts[0].includes("Arch Proj Architect"));
    assert.ok(prompts[0].includes("event-driven"));
    assert.ok(!prompts[0].includes("General design guidelines"));
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
    await h.writePrompt("orchestrator", "ticks\nfire stitcher", "firstlight");
    await h.writePrompt("orchestrator", "wasps\nfire hullcracker");

    const result = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:99", {
      channel: "telegram",
    });

    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("ticks"));
    assert.ok(result.orchestratorContent?.includes("fire stitcher"));
    assert.ok(!result.orchestratorContent?.includes("wasps"));
  });

  it("should replace stale orchestrator.md content across repeated fresh bootstrap runs on the same topic key", async () => {
    h = await createTestHarness({ projectName: "firstlight", channelId: "-1000000000002", messageThreadId: 7 });
    const projectPrompt = path.join(h.workspaceDir, "devclaw", "projects", "firstlight", "prompts", "orchestrator.md");
    const workspacePrompt = path.join(h.workspaceDir, "devclaw", "prompts", "orchestrator.md");

    await h.writePrompt("orchestrator", "wasps\nfire hullcracker");
    await h.writePrompt("orchestrator", "ticks\nfire stitcher", "firstlight");

    const first = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
    });
    assert.ok(first.orchestratorContent?.includes("ticks"));
    assert.ok(first.orchestratorContent?.includes("fire stitcher"));

    await fs.rm(projectPrompt);
    const second = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
      bootstrapFiles: first.bootstrapFiles,
    });
    assert.ok(second.orchestratorContent?.includes("wasps"));
    assert.ok(second.orchestratorContent?.includes("fire hullcracker"));
    assert.ok(!second.orchestratorContent?.includes("ticks"));
    assert.ok(!second.orchestratorContent?.includes("fire stitcher"));

    await fs.writeFile(projectPrompt, "ticks v2\nfire needlecaster", "utf-8");
    const third = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
      bootstrapFiles: second.bootstrapFiles,
    });
    assert.ok(third.orchestratorContent?.includes("ticks v2"));
    assert.ok(third.orchestratorContent?.includes("fire needlecaster"));
    assert.ok(!third.orchestratorContent?.includes("wasps"));
    assert.ok(!third.orchestratorContent?.includes("fire hullcracker"));

    await fs.writeFile(workspacePrompt, "wasps v2\nfire emberhammer", "utf-8");
    await fs.rm(projectPrompt);
    const fourth = await h.simulateBootstrap("agent:devclaw:telegram:group:-1000000000002:topic:7", {
      channel: "telegram",
      bootstrapFiles: third.bootstrapFiles,
    });
    assert.ok(fourth.orchestratorContent?.includes("wasps v2"));
    assert.ok(fourth.orchestratorContent?.includes("fire emberhammer"));
    assert.ok(!fourth.orchestratorContent?.includes("ticks v2"));
    assert.ok(!fourth.orchestratorContent?.includes("fire needlecaster"));
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
