import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../../../", import.meta.url);
const manifestPath = new URL("openclaw.plugin.json", repositoryRoot);
const entrypointPath = new URL("index.ts", repositoryRoot);

const expectedToolNames = [
  "task_start",
  "work_finish",
  "task_create",
  "task_edit_body",
  "task_comment",
  "task_attach",
  "task_set_level",
  "task_owner",
  "research_task",
  "orchestrator_intervention",
  "task_list",
  "tasks_status",
  "project_status",
  "project_register",
  "health",
  "sync_labels",
  "channel_link",
  "channel_unlink",
  "channel_list",
  "setup",
  "onboard",
  "autoconfigure_models",
  "workflow_guide",
  "config",
];

function assertExactToolSet(label, actualToolNames) {
  assert.equal(
    new Set(actualToolNames).size,
    actualToolNames.length,
    `${label} must not contain duplicate tool names`,
  );
  assert.deepEqual(
    [...actualToolNames].sort(),
    [...expectedToolNames].sort(),
    `${label} must contain exactly the expected DevClaw tools`,
  );
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.ok(
  Array.isArray(manifest.contracts?.tools),
  "openclaw.plugin.json must declare contracts.tools",
);
assertExactToolSet("openclaw.plugin.json contracts.tools", manifest.contracts.tools);

const entrypoint = await readFile(entrypointPath, "utf8");
const registeredToolNames = [
  ...entrypoint.matchAll(
    /api\.registerTool\([^;\r\n]*\{\s*names:\s*\[\s*"([^"]+)"\s*\]\s*\}\s*\);/g,
  ),
].map((match) => match[1]);

assertExactToolSet("index.ts api.registerTool registrations", registeredToolNames);
assert.deepEqual(
  [...manifest.contracts.tools].sort(),
  [...registeredToolNames].sort(),
  "manifest tool ownership must match runtime tool registrations",
);

console.log(`Plugin tool contract verified (${expectedToolNames.length} tools)`);
