/**
 * workspace.test.ts — Tests for write-once default file behavior.
 *
 * Verifies that ensureDefaultFiles() creates missing files but never
 * overwrites user-owned config (workflow.yaml, prompts, IDENTITY.md).
 *
 * Run: npx tsx --test lib/setup/workspace.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureDefaultFiles, fileExists } from "./workspace.js";
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
  it("should migrate root-level legacy projects.json instead of creating an empty registry", async () => {
    const ws = await makeTmpDir();
    const legacy = {
      projects: {
        sample: {
          slug: "sample",
          name: "sample",
          repo: "~/git/sample",
          groupName: "Sample",
          deployUrl: "",
          baseBranch: "main",
          deployBranch: "main",
          channels: [{ channelId: "1", channel: "telegram", name: "primary", events: ["*"] }],
          workers: {},
        },
      },
    };
    await fs.writeFile(path.join(ws, "projects.json"), JSON.stringify(legacy, null, 2) + "\n", "utf-8");

    await ensureDefaultFiles(ws);

    const canonicalPath = path.join(ws, DATA_DIR, "projects.json");
    assert.ok(await fileExists(canonicalPath), "canonical projects.json should exist");
    const migrated = JSON.parse(await fs.readFile(canonicalPath, "utf-8"));
    assert.deepStrictEqual(migrated, legacy, "legacy registry should be preserved and migrated");
    assert.ok(!(await fileExists(path.join(ws, "projects.json"))), "legacy root projects.json should be removed after migration");
  });

  it("should migrate old projects/projects.json instead of creating an empty registry", async () => {
    const ws = await makeTmpDir();
    const legacy = {
      projects: {
        sample: {
          name: "sample",
          repo: "~/git/sample",
          groupName: "Sample",
          deployUrl: "",
          baseBranch: "main",
          deployBranch: "main",
          dev: { active: true, issueId: "42", startTime: null, level: "mid", sessions: { mid: "key-1" } },
          qa: { active: false, issueId: null, startTime: null, level: null, sessions: {} },
          architect: { active: false, issueId: null, startTime: null, level: null, sessions: {} },
        },
      },
    };
    await fs.mkdir(path.join(ws, "projects"), { recursive: true });
    await fs.writeFile(path.join(ws, "projects", "projects.json"), JSON.stringify(legacy, null, 2) + "\n", "utf-8");

    await ensureDefaultFiles(ws);

    const canonicalPath = path.join(ws, DATA_DIR, "projects.json");
    assert.ok(await fileExists(canonicalPath), "canonical projects.json should exist");
    const migrated = JSON.parse(await fs.readFile(canonicalPath, "utf-8"));
    assert.deepStrictEqual(migrated, legacy, "old-layout registry should be preserved and migrated");
    assert.ok(!(await fileExists(path.join(ws, "projects", "projects.json"))), "old-layout projects.json should be removed after migration");
  });

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

  it("should always overwrite AGENTS.md (system instructions)", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, "AGENTS.md");
    await fs.writeFile(agentsPath, "# Old agents content", "utf-8");

    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(agentsPath, "utf-8");
    assert.notStrictEqual(afterContent, "# Old agents content", "AGENTS.md should be overwritten");
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
