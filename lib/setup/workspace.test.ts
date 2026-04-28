/**
 * workspace.test.ts — Tests for default workspace file behavior.
 *
 * Verifies that ensureDefaultFiles() preserves user-owned config and only
 * manages tagged DevClaw blocks in workspace-root guidance files.
 *
 * Run: npx tsx --test lib/setup/workspace.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureDefaultFiles, fileExists, writeAllDefaults } from "./workspace.js";
import { DATA_DIR } from "./migrate-layout.js";

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-ws-test-"));
  // Create the log dir so audit logging doesn't fail
  await fs.mkdir(path.join(tmpDir, DATA_DIR, "log"), { recursive: true });
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ensureDefaultFiles — managed root-block behavior", () => {
  it("should create workflow.yaml when missing", async () => {
    const ws = await makeTmpDir();
    await ensureDefaultFiles(ws);
    const workflowPath = path.join(ws, DATA_DIR, "workflow.yaml");
    assert.ok(await fileExists(workflowPath), "workflow.yaml should be created");
  });

  it("should NOT overwrite existing workflow.yaml", async () => {
    const ws = await makeTmpDir();
    const workflowPath = path.join(ws, DATA_DIR, "workflow.yaml");
    await fs.mkdir(path.dirname(workflowPath), { recursive: true });
    const customContent = "# My custom workflow\nroles:\n  developer:\n    models:\n      junior: openai/gpt-4\n";
    await fs.writeFile(workflowPath, customContent, "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(workflowPath, "utf-8");
    assert.strictEqual(afterContent, customContent, "workflow.yaml should not be overwritten");
  });

  it("should create prompt files when missing", async () => {
    const ws = await makeTmpDir();
    await ensureDefaultFiles(ws);
    const devPrompt = path.join(ws, DATA_DIR, "prompts", "developer.md");
    assert.ok(await fileExists(devPrompt), "developer.md prompt should be created");
  });

  it("should NOT overwrite existing prompt files", async () => {
    const ws = await makeTmpDir();
    const devPrompt = path.join(ws, DATA_DIR, "prompts", "developer.md");
    await fs.mkdir(path.dirname(devPrompt), { recursive: true });
    const customPrompt = "# My custom developer instructions\nAlways use TypeScript.";
    await fs.writeFile(devPrompt, customPrompt, "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(devPrompt, "utf-8");
    assert.strictEqual(afterContent, customPrompt, "developer.md should not be overwritten");
  });

  it("should NOT delete project-specific prompts", async () => {
    const ws = await makeTmpDir();
    const projectPrompt = path.join(ws, DATA_DIR, "projects", "my-app", "prompts", "developer.md");
    await fs.mkdir(path.dirname(projectPrompt), { recursive: true });
    const customPrompt = "# My App Developer\nUse React.";
    await fs.writeFile(projectPrompt, customPrompt, "utf-8");

    await ensureDefaultFiles(ws);

    assert.ok(await fileExists(projectPrompt), "project-specific prompt should still exist");
    const afterContent = await fs.readFile(projectPrompt, "utf-8");
    assert.strictEqual(afterContent, customPrompt, "project-specific prompt should be untouched");
  });

  it("should create IDENTITY.md when missing but not overwrite", async () => {
    const ws = await makeTmpDir();

    // First run: creates it
    await ensureDefaultFiles(ws);
    const identityPath = path.join(ws, "IDENTITY.md");
    assert.ok(await fileExists(identityPath), "IDENTITY.md should be created");

    // Customize it
    const customIdentity = "# My Identity\nI am a lobster.";
    await fs.writeFile(identityPath, customIdentity, "utf-8");

    // Second run: should NOT overwrite
    await ensureDefaultFiles(ws);
    const afterContent = await fs.readFile(identityPath, "utf-8");
    assert.strictEqual(afterContent, customIdentity, "IDENTITY.md should not be overwritten");
  });

  it("should scaffold AGENTS.md with a managed block when missing", async () => {
    const ws = await makeTmpDir();

    await ensureDefaultFiles(ws);

    const agentsPath = path.join(ws, "AGENTS.md");
    const content = await fs.readFile(agentsPath, "utf-8");
    assert.match(content, /<!-- DEVCLAW:START agents -->/);
    assert.match(content, /<!-- DEVCLAW:END agents -->/);
  });

  it("should insert a managed block into an existing AGENTS.md without destroying user content", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, "AGENTS.md");
    const before = "# My workspace rules\n\nKeep this.\n\n## After\nStill mine.\n";
    await fs.writeFile(agentsPath, before, "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(agentsPath, "utf-8");
    assert.match(afterContent, /^# My workspace rules/m);
    assert.match(afterContent, /Keep this\./);
    assert.match(afterContent, /^## After$/m);
    assert.match(afterContent, /Still mine\./);
    assert.match(afterContent, /<!-- DEVCLAW:START agents -->[\s\S]*<!-- DEVCLAW:END agents -->/);
  });

  it("should update an existing managed block without duplicating it", async () => {
    const ws = await makeTmpDir();
    const toolsPath = path.join(ws, "TOOLS.md");
    await fs.writeFile(
      toolsPath,
      "Intro\n\n<!-- DEVCLAW:START tools -->\nold block\n<!-- DEVCLAW:END tools -->\n\nOutro\n",
      "utf-8",
    );

    await ensureDefaultFiles(ws);
    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(toolsPath, "utf-8");
    const blockCount = (afterContent.match(/<!-- DEVCLAW:START tools -->/g) ?? []).length;
    assert.strictEqual(blockCount, 1, "managed block should not be duplicated");
    assert.match(afterContent, /^Intro/m);
    assert.match(afterContent, /^Outro/m);
    assert.ok(!afterContent.includes("old block"), "managed block should be refreshed");
  });

  it("should preserve customized HEARTBEAT.md and TOOLS.md content outside managed blocks", async () => {
    const ws = await makeTmpDir();
    const heartbeatPath = path.join(ws, "HEARTBEAT.md");
    const toolsPath = path.join(ws, "TOOLS.md");
    await fs.writeFile(heartbeatPath, "Before\n\nAfter heartbeat\n", "utf-8");
    await fs.writeFile(toolsPath, "Before tools\n\nAfter tools\n", "utf-8");

    await ensureDefaultFiles(ws);

    const heartbeat = await fs.readFile(heartbeatPath, "utf-8");
    const tools = await fs.readFile(toolsPath, "utf-8");
    assert.match(heartbeat, /^Before/m);
    assert.match(heartbeat, /^After heartbeat$/m);
    assert.match(heartbeat, /<!-- DEVCLAW:START heartbeat -->/);
    assert.match(tools, /^Before tools/m);
    assert.match(tools, /^After tools$/m);
    assert.match(tools, /<!-- DEVCLAW:START tools -->/);
  });

  it("should let explicit reset/default-writing flows overwrite intentionally", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, "AGENTS.md");
    await fs.writeFile(agentsPath, "# Custom root file\n", "utf-8");

    const written = await writeAllDefaults(ws, true);
    const afterContent = await fs.readFile(agentsPath, "utf-8");

    assert.ok(written.includes("AGENTS.md"));
    assert.ok(!afterContent.includes("# Custom root file"), "reset-defaults should replace the full file");
    assert.ok(afterContent.includes("DevClaw"), "reset-defaults should restore the package template");
  });

  it("should let eject-defaults skip existing customized root files", async () => {
    const ws = await makeTmpDir();
    const toolsPath = path.join(ws, "TOOLS.md");
    await fs.writeFile(toolsPath, "# Custom tools\n", "utf-8");

    const written = await writeAllDefaults(ws, false);
    const afterContent = await fs.readFile(toolsPath, "utf-8");

    assert.ok(!written.includes("TOOLS.md"));
    assert.strictEqual(afterContent, "# Custom tools\n");
  });

  it("should write .version file", async () => {
    const ws = await makeTmpDir();
    await ensureDefaultFiles(ws);
    const versionPath = path.join(ws, DATA_DIR, ".version");
    assert.ok(await fileExists(versionPath), ".version file should be created");
    const content = await fs.readFile(versionPath, "utf-8");
    assert.ok(content.trim().length > 0, ".version should contain a version string");
  });
});
