/**
 * Regression guard for issue #108.
 *
 * Generic-facing code, tests, and docs must not hardcode local fork identifiers.
 * Local-only runbooks/config may document environment-specific details separately.
 *
 * Run with: npx tsx --test lib/regression/fork-identifiers.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const forbiddenIdentifiers = [
  ["yaqub0r", "devclaw"].join("/"),
  ["github.com", "yaqub0r", "devclaw"].join("/"),
  `@${["yaqub0r", "devclaw"].join("/")}`,
];

const includeExtensions = new Set([".md", ".ts", ".js", ".json", ".yml", ".yaml"]);
const excludedDirs = new Set([
  ".git",
  "dist",
  "node_modules",
  ".openclaw",
]);

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (excludedDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }
    if (!includeExtensions.has(path.extname(entry.name))) continue;
    files.push(fullPath);
  }

  return files;
}

describe("regression guard: local fork identifiers stay out of generic-facing sources", () => {
  it("should not contain known local fork repo identifiers outside local-only surfaces", async () => {
    const files = await walk(repoRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (rel === "lib/regression/fork-identifiers.test.ts") continue;
      if (rel.startsWith("dev/runbooks/")) continue;
      if (rel.startsWith("dev/regression/issues/")) continue;

      const content = await fs.readFile(file, "utf-8");
      const hits = forbiddenIdentifiers.filter(identifier => content.includes(identifier));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(", ")}`);
    }

    assert.deepStrictEqual(
      offenders,
      [],
      `Found forbidden local fork identifiers in generic-facing files:\n${offenders.join("\n")}`,
    );
  });
});
