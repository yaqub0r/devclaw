/**
 * Regression tests for projectTick provider creation with repoRemote targeting.
 *
 * Run with: npx tsx --test lib/services/tick-provider-targeting.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "../testing/index.js";
import { projectTick } from "./tick.js";

describe("projectTick provider targeting", () => {
  it("threads project repoRemote into provider creation from persisted project config", async () => {
    const h = await createTestHarness();
    try {
      const projects = await h.readProjects();
      projects.projects[h.project.slug] = {
        ...projects.projects[h.project.slug]!,
        repoRemote: "https://github.com/yaqub0r/devclaw.git",
        provider: "github",
      };
      await h.writeProjects(projects);

      const ghCalls: string[][] = [];
      const runCommand = async (argv: string[]) => {
        if (argv[0] === "gh") {
          ghCalls.push(argv);
          if (argv[1] === "issue" && argv[2] === "list") {
            return { stdout: "[]", stderr: "", code: 0, signal: null, killed: false as const };
          }
        }
        return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false as const };
      };

      const result = await projectTick({
        workspaceDir: h.workspaceDir,
        projectSlug: h.project.slug,
        targetRole: "developer",
        runCommand: runCommand as any,
      });

      assert.equal(result.pickups.length, 0);
      const issueListCalls = ghCalls.filter((call) => call[1] === "issue" && call[2] === "list");
      assert.ok(issueListCalls.length >= 1, "expected projectTick to hit gh through a created provider");
      for (const call of issueListCalls) {
        assert.deepEqual(call.slice(-2), ["--repo", "yaqub0r/devclaw"]);
      }
    } finally {
      await h.cleanup();
    }
  });
});
