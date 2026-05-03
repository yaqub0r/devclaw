/**
 * E2E bootstrap tests — verifies role instructions reach workers via extraSystemPrompt:
 *   dispatchTask() → loadRoleInstructions() → gateway agent call includes extraSystemPrompt
 *
 * Also tests that the agent:bootstrap hook strips AGENTS.md from worker sessions.
 *
 * Run: npx tsx --test lib/services/bootstrap.e2e.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
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

    // Write both default and project-specific prompts
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

    // Verify extraSystemPrompt in the gateway agent call
    const prompts = h.commands.extraSystemPrompts();
    assert.strictEqual(prompts.length, 1, `Expected 1 extraSystemPrompt, got ${prompts.length}`);
    assert.ok(prompts[0].includes("My App Developer"), `Got: ${prompts[0]}`);
    assert.ok(prompts[0].includes("Use React"));
    assert.ok(!prompts[0].includes("Generic instructions"));
  });

  it("should fall back to default instructions when no project override exists", async () => {
    h = await createTestHarness({ projectName: "other-app" });
    h.provider.seedIssue({ iid: 2, title: "Fix bug", labels: ["To Do"] });

    // Only write default prompt — no project-specific
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

    // Don't write any custom prompts — ensureWorkspaceMigrated scaffolds defaults

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
    assert.strictEqual(prompts.length, 1, "Default scaffolded prompt should be injected");
    assert.match(prompts[0], /Developer/i);
  });

  it("should resolve tester instructions independently from developer", async () => {
    h = await createTestHarness({ projectName: "multi-role" });
    h.provider.seedIssue({ iid: 4, title: "Test thing", labels: ["To Test"] });

    // Write project-specific for developer, default for tester
    await h.writePrompt("developer", "# Dev for multi-role\nSpecific dev rules.", "multi-role");
    await h.writePrompt("tester", "# Default Tester\nRun integration tests.");

    // Dispatch as tester
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

    const result = await h.simulateBootstrap(
      "agent:main:subagent:my-app-developer-medior-Ada",
    );
    assert.ok(result.agentsContent);
    assert.ok(!result.agentsContent?.includes("Orchestrator instructions"));
    assert.ok(!result.bootstrapFileNames.includes("orchestrator.md"));
  });

  it("should inject the project-specific orchestrator prompt into the legacy main session", async () => {
    h = await createTestHarness({ projectName: "my-app" });
    await h.writePrompt("orchestrator", "# My App Orchestrator\nUse the app-specific workflow.", "my-app");
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:main:main", {
      channelId: h.channelId,
      channel: "telegram",
    });

    assert.strictEqual(result.agentsMdStripped, false);
    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("My App Orchestrator"));
    assert.ok(!result.orchestratorContent?.includes("Generic workflow"));
  });

  it("should inject the project-specific orchestrator prompt into a real chat-backed orchestrator session", async () => {
    h = await createTestHarness({ projectName: "my-app", channelId: "-1003581929219", messageThreadId: 190 });
    await h.writePrompt("orchestrator", "# My App Orchestrator\nUse the app-specific workflow.", "my-app");
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:devclaw:telegram:group:-1003581929219:topic:190", {
      channelId: "-1003581929219",
      channel: "telegram",
      messageThreadId: 190,
    });

    assert.strictEqual(result.agentsMdStripped, false);
    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("My App Orchestrator"));
    assert.ok(!result.orchestratorContent?.includes("Generic workflow"));
  });

  it("should resolve the project-specific orchestrator prompt from the real session key when bootstrap context omits chat scope", async () => {
    h = await createTestHarness({ projectName: "firstlight", channelId: "-1003746138337", messageThreadId: 2270 });
    await h.writePrompt(
      "orchestrator",
      "You must follow a three step process when killing ticks:\n1. steady\n2. aim\n3. fire stitcher",
      "firstlight",
    );
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:devclaw:telegram:group:-1003746138337:topic:2270", {
      channel: "telegram",
    });

    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("three step process when killing ticks"));
    assert.ok(result.orchestratorContent?.includes("fire stitcher"));
    assert.ok(!result.orchestratorContent?.includes("Generic workflow"));
  });

  it("should fall back to workspace orchestrator prompt for chat-scoped resolution misses", async () => {
    h = await createTestHarness({ projectName: "my-app" });
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:main:main", {
      channelId: "unbound-chat",
      channel: "telegram",
    });

    assert.ok(result.bootstrapFileNames.includes("orchestrator.md"));
    assert.ok(result.orchestratorContent?.includes("Workspace Orchestrator"));
  });

  it("should resolve project-specific orchestrator prompt by topic when applicable", async () => {
    h = await createTestHarness({ projectName: "my-app", messageThreadId: 42 });
    await h.writePrompt("orchestrator", "# Topic Orchestrator\nUse topic-specific workflow.", "my-app");
    await h.writePrompt("orchestrator", "# Workspace Orchestrator\nGeneric workflow.");

    const result = await h.simulateBootstrap("agent:main:main", {
      channelId: h.channelId,
      channel: "telegram",
      messageThreadId: 42,
    });

    assert.ok(result.orchestratorContent?.includes("Topic Orchestrator"));
    assert.ok(!result.orchestratorContent?.includes("Generic workflow"));
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

  it("should NOT strip AGENTS.md for unknown roles", async () => {
    h = await createTestHarness({ projectName: "custom-app" });

    const result = await h.simulateBootstrap(
      "agent:main:subagent:custom-app-investigator-medior",
    );
    assert.strictEqual(result.agentsMdStripped, false);
    assert.ok(!result.bootstrapFileNames.includes("orchestrator.md"));
  });
});
