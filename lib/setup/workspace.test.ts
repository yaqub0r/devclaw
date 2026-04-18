/**
 * workspace.test.ts — Tests for write-once default file behavior.
 *
 * Verifies that ensureDefaultFiles() creates missing files but never
 * overwrites existing workspace bootstrap/config files during normal startup.
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

describe("ensureDefaultFiles — write-once behavior", () => {
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

  it("should NOT overwrite existing AGENTS.md on normal startup", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, "AGENTS.md");
    const customContent = "# Old agents content";
    await fs.writeFile(agentsPath, customContent, "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(agentsPath, "utf-8");
    assert.strictEqual(afterContent, customContent, "AGENTS.md should not be overwritten on normal startup");
  });

  it("should NOT overwrite existing HEARTBEAT.md on normal startup", async () => {
    const ws = await makeTmpDir();
    const heartbeatPath = path.join(ws, "HEARTBEAT.md");
    const customContent = "# custom heartbeat";
    await fs.writeFile(heartbeatPath, customContent, "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(heartbeatPath, "utf-8");
    assert.strictEqual(afterContent, customContent, "HEARTBEAT.md should not be overwritten on normal startup");
  });

  it("should NOT overwrite existing TOOLS.md on normal startup", async () => {
    const ws = await makeTmpDir();
    const toolsPath = path.join(ws, "TOOLS.md");
    const customContent = "# custom tools";
    await fs.writeFile(toolsPath, customContent, "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(toolsPath, "utf-8");
    assert.strictEqual(afterContent, customContent, "TOOLS.md should not be overwritten on normal startup");
  });

  it("should still overwrite bootstrap files when writeAllDefaults is forced", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, "AGENTS.md");
    const heartbeatPath = path.join(ws, "HEARTBEAT.md");
    const toolsPath = path.join(ws, "TOOLS.md");

    await fs.writeFile(agentsPath, "# custom agents", "utf-8");
    await fs.writeFile(heartbeatPath, "# custom heartbeat", "utf-8");
    await fs.writeFile(toolsPath, "# custom tools", "utf-8");

    await writeAllDefaults(ws, true);

    assert.notStrictEqual(await fs.readFile(agentsPath, "utf-8"), "# custom agents", "forced defaults should overwrite AGENTS.md");
    assert.notStrictEqual(await fs.readFile(heartbeatPath, "utf-8"), "# custom heartbeat", "forced defaults should overwrite HEARTBEAT.md");
    assert.notStrictEqual(await fs.readFile(toolsPath, "utf-8"), "# custom tools", "forced defaults should overwrite TOOLS.md");
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
