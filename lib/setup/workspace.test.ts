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

function escapeRegexForTest(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

  it("should insert a managed notice and block into an existing AGENTS.md without destroying user content", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, "AGENTS.md");
    const before = "# My workspace rules\n\nKeep this.\n\n## After\nStill mine.\n";
    await fs.writeFile(agentsPath, before, "utf-8");

    await ensureDefaultFiles(ws);
    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(agentsPath, "utf-8");
    const blockCount = (afterContent.match(/<!-- DEVCLAW:START agents -->/g) ?? []).length;
    const noticeCount = (afterContent.match(/<!-- DEVCLAW:NOTICE:START agents -->/g) ?? []).length;
    assert.strictEqual(blockCount, 1, "managed block should not be duplicated");
    assert.strictEqual(noticeCount, 1, "managed notice should not be duplicated");
    assert.match(afterContent, /^# My workspace rules/m);
    assert.match(afterContent, /Keep this\./);
    assert.match(afterContent, /^## After$/m);
    assert.match(afterContent, /Still mine\./);
    assert.match(afterContent, /<!-- DEVCLAW:NOTICE:START agents -->[\s\S]*may replace those changes the next time it refreshes defaults\.[\s\S]*<!-- DEVCLAW:NOTICE:END agents -->/);
    assert.match(afterContent, /<!-- DEVCLAW:START agents -->[\s\S]*<!-- DEVCLAW:END agents -->/);
  });

  it("should update an existing managed block, seed its notice, and avoid duplication", async () => {
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
    const noticeCount = (afterContent.match(/<!-- DEVCLAW:NOTICE:START tools -->/g) ?? []).length;
    assert.strictEqual(blockCount, 1, "managed block should not be duplicated");
    assert.strictEqual(noticeCount, 1, "managed notice should not be duplicated");
    assert.match(afterContent, /^Intro/m);
    assert.match(afterContent, /^Outro/m);
    assert.match(afterContent, /Add workspace-specific tool notes outside the managed block\./);
    assert.ok(!afterContent.includes("old block"), "managed block should be refreshed");
  });

  it("should append only the missing block when the managed notice already exists", async () => {
    const ws = await makeTmpDir();
    const toolsPath = path.join(ws, "TOOLS.md");
    await fs.writeFile(
      toolsPath,
      [
        "Intro",
        "",
        "<!-- DEVCLAW:NOTICE:START tools -->",
        "stale notice",
        "<!-- DEVCLAW:NOTICE:END tools -->",
        "",
        "Outro",
        "",
      ].join("\n"),
      "utf-8",
    );

    await ensureDefaultFiles(ws);
    await ensureDefaultFiles(ws);

    const afterContent = await fs.readFile(toolsPath, "utf-8");
    const blockCount = (afterContent.match(/<!-- DEVCLAW:START tools -->/g) ?? []).length;
    const noticeCount = (afterContent.match(/<!-- DEVCLAW:NOTICE:START tools -->/g) ?? []).length;

    assert.strictEqual(blockCount, 1, "should insert exactly one managed block");
    assert.strictEqual(noticeCount, 1, "should not duplicate the managed notice");
    assert.match(afterContent, /^Intro/m);
    assert.match(afterContent, /^Outro$/m);
    assert.match(afterContent, /Add workspace-specific tool notes outside the managed block\./);
    assert.ok(!afterContent.includes("stale notice"), "existing notice should be refreshed");
  });

  it("should normalize legacy full-file DevClaw root docs into a single managed block without duplication", async () => {
    const ws = await makeTmpDir();
    const legacyFiles = [
      {
        fileName: "AGENTS.md",
        sectionId: "agents",
        template: (await import("./templates.js")).AGENTS_MD_TEMPLATE,
      },
      {
        fileName: "HEARTBEAT.md",
        sectionId: "heartbeat",
        template: (await import("./templates.js")).HEARTBEAT_MD_TEMPLATE,
      },
      {
        fileName: "TOOLS.md",
        sectionId: "tools",
        template: (await import("./templates.js")).TOOLS_MD_TEMPLATE,
      },
    ];

    for (const { fileName, sectionId, template } of legacyFiles) {
      const filePath = path.join(ws, fileName);
      const legacyContent = template.replace(/\n/g, "\r\n");
      await fs.writeFile(filePath, legacyContent, "utf-8");

      await ensureDefaultFiles(ws);
      await ensureDefaultFiles(ws);

      const afterContent = await fs.readFile(filePath, "utf-8");
      const noticeCount = (afterContent.match(new RegExp(`<!-- DEVCLAW:NOTICE:START ${sectionId} -->`, "g")) ?? []).length;
      const blockCount = (afterContent.match(new RegExp(`<!-- DEVCLAW:START ${sectionId} -->`, "g")) ?? []).length;

      assert.strictEqual(noticeCount, 1, `${fileName} notice should be normalized exactly once`);
      assert.strictEqual(blockCount, 1, `${fileName} block should be normalized exactly once`);
      assert.doesNotMatch(afterContent, new RegExp(`${escapeRegexForTest(template.trim())}\\s*<!-- DEVCLAW:START ${sectionId} -->`), `${fileName} should not retain the legacy full-file template above the managed block`);
    }
  });

  it("should preserve customized HEARTBEAT.md content outside managed sections across restarts", async () => {
    const ws = await makeTmpDir();
    const heartbeatPath = path.join(ws, "HEARTBEAT.md");
    const customHeartbeat = "Before\n\nAfter heartbeat\n";
    await fs.writeFile(heartbeatPath, customHeartbeat, "utf-8");

    await ensureDefaultFiles(ws);
    await ensureDefaultFiles(ws);

    const heartbeat = await fs.readFile(heartbeatPath, "utf-8");
    const noticeCount = (heartbeat.match(/<!-- DEVCLAW:NOTICE:START heartbeat -->/g) ?? []).length;
    const blockCount = (heartbeat.match(/<!-- DEVCLAW:START heartbeat -->/g) ?? []).length;
    assert.strictEqual(noticeCount, 1, "managed notice should not be duplicated");
    assert.strictEqual(blockCount, 1, "managed block should not be duplicated");
    assert.match(heartbeat, /^Before/m);
    assert.match(heartbeat, /^After heartbeat$/m);
    assert.match(heartbeat, /<!-- DEVCLAW:NOTICE:START heartbeat -->/);
    assert.match(heartbeat, /<!-- DEVCLAW:START heartbeat -->/);
    assert.ok(heartbeat.includes("Before\n\nAfter heartbeat"), "custom heartbeat content should survive restart");
  });

  it("should preserve customized TOOLS.md content outside managed sections across restarts", async () => {
    const ws = await makeTmpDir();
    const toolsPath = path.join(ws, "TOOLS.md");
    const customTools = "Before tools\n\nAfter tools\n";
    await fs.writeFile(toolsPath, customTools, "utf-8");

    await ensureDefaultFiles(ws);
    await ensureDefaultFiles(ws);

    const tools = await fs.readFile(toolsPath, "utf-8");
    const noticeCount = (tools.match(/<!-- DEVCLAW:NOTICE:START tools -->/g) ?? []).length;
    const blockCount = (tools.match(/<!-- DEVCLAW:START tools -->/g) ?? []).length;
    assert.strictEqual(noticeCount, 1, "managed notice should not be duplicated");
    assert.strictEqual(blockCount, 1, "managed block should not be duplicated");
    assert.match(tools, /^Before tools/m);
    assert.match(tools, /^After tools$/m);
    assert.match(tools, /<!-- DEVCLAW:NOTICE:START tools -->/);
    assert.match(tools, /<!-- DEVCLAW:START tools -->/);
    assert.ok(tools.includes("Before tools\n\nAfter tools"), "custom tools content should survive restart");
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
