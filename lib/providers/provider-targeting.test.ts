/**
 * Regression tests for explicit tracker targeting from project config.
 *
 * Run with: npx tsx --test lib/providers/provider-targeting.test.ts
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GitHubProvider } from "./github.js";

describe("GitHubProvider explicit repo targeting", () => {
  it("passes --repo for issue creation when target repo is configured", async () => {
    const calls: string[][] = [];
    const runCommand = mock.fn(async (args: string[]) => {
      calls.push(args);
      if (args[1] === "issue" && args[2] === "create") {
        return { stdout: "https://github.com/yaqub0r/devclaw/issues/999\n", stderr: "", code: 0 };
      }
      if (args[1] === "issue" && args[2] === "view") {
        return {
          stdout: JSON.stringify({ number: 999, title: "t", body: "d", labels: [{ name: "Planning" }], state: "OPEN", url: "https://github.com/yaqub0r/devclaw/issues/999" }),
          stderr: "",
          code: 0,
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: runCommand as any, target: { repo: "yaqub0r/devclaw" } });
    const issue = await provider.createIssue("t", "d", "Planning");

    assert.equal(issue.iid, 999);
    const createCall = calls.find((c) => c[1] === "issue" && c[2] === "create");
    assert.ok(createCall, "expected issue create call");
    assert.deepEqual(createCall.slice(-2), ["--repo", "yaqub0r/devclaw"]);
  });

  it("uses configured target repo for repo info without gh repo view", async () => {
    const runCommand = mock.fn(async (_args: string[]) => {
      throw new Error("gh repo view should not be called when target is configured");
    });

    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: runCommand as any, target: { repo: "yaqub0r/devclaw" } });
    const info = await (provider as any).getRepoInfo();

    assert.deepEqual(info, { owner: "yaqub0r", name: "devclaw" });
    assert.equal(runCommand.mock.calls.length, 0);
  });
});
