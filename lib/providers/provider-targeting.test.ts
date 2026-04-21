/**
 * Regression tests for explicit tracker targeting from project config.
 *
 * Run with: npx tsx --test lib/providers/provider-targeting.test.ts
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GitHubProvider } from "./github.js";
import { resolveProvider } from "../tools/helpers.js";

describe("GitHubProvider explicit repo targeting", () => {
  it("derives the tracker target from project repoRemote and forces issue creation onto that repo", async () => {
    const calls: string[][] = [];
    const runCommand = mock.fn(async (args: string[]) => {
      calls.push(args);

      if (args[0] === "gh" && args[1] === "issue" && args[2] === "create") {
        const explicitRepoIndex = args.indexOf("--repo");
        const targetRepo = explicitRepoIndex >= 0 ? args[explicitRepoIndex + 1] : "upstream/wrong-repo";
        return { stdout: `https://github.com/${targetRepo}/issues/321\n`, stderr: "", code: 0 };
      }

      if (args[0] === "gh" && args[1] === "issue" && args[2] === "view") {
        return {
          stdout: JSON.stringify({
            number: 321,
            title: "stable regression",
            body: "protect repo routing",
            labels: [{ name: "Planning" }],
            state: "OPEN",
            url: "https://github.com/yaqub0r/devclaw/issues/321",
          }),
          stderr: "",
          code: 0,
        };
      }

      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    const { provider, type } = await resolveProvider({
      name: "devclaw",
      repo: "~/git/devclaw-fork",
      repoRemote: "git@github.com:yaqub0r/devclaw.git",
      provider: "github",
      baseBranch: "main",
      channels: [],
    } as any, runCommand as any);

    assert.equal(type, "github");
    const issue = await provider.createIssue("stable regression", "protect repo routing", "Planning");
    assert.equal(issue.iid, 321);
    assert.equal(issue.web_url, "https://github.com/yaqub0r/devclaw/issues/321");

    const createCall = calls.find((c) => c[0] === "gh" && c[1] === "issue" && c[2] === "create");
    assert.ok(createCall, "expected issue create call");
    assert.deepEqual(createCall.slice(-2), ["--repo", "yaqub0r/devclaw"]);
  });

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

  it("passes --repo for issue read, edit, label, and comment paths when target repo is configured", async () => {
    const calls: string[][] = [];
    let issue95State = "Planning";
    const runCommand = mock.fn(async (args: string[]) => {
      calls.push(args);

      if (args[1] === "issue" && args[2] === "view") {
        const issueId = args[3];
        const labels = issueId === "95"
          ? [{ name: issue95State }, { name: "telegram:DevClaw" }]
          : [{ name: "To Do" }, { name: "telegram:DevClaw" }];
        return {
          stdout: JSON.stringify({ number: Number(issueId), title: "Issue", body: "Body", labels, state: "OPEN", url: `https://github.com/yaqub0r/devclaw/issues/${issueId}` }),
          stderr: "",
          code: 0,
        };
      }

      if (args[1] === "issue" && args[2] === "edit") {
        if (args.includes("--add-label") && args.includes("To Do")) issue95State = "To Do";
        return { stdout: "", stderr: "", code: 0 };
      }

      if (args[1] === "label" && args[2] === "create") {
        return { stdout: "", stderr: "", code: 0 };
      }

      if (args[1] === "api" && args[2] === "repos/:owner/:repo/issues/95/comments") {
        return { stdout: JSON.stringify({ id: 12345 }), stderr: "", code: 0 };
      }

      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: runCommand as any, target: { repo: "yaqub0r/devclaw" } });

    const issue = await provider.getIssue(95);
    assert.equal(issue.iid, 95);

    await provider.transitionLabel(95, "Planning", "To Do");
    await provider.ensureLabel("developer:medior", "#123456");
    const commentId = await provider.addComment(95, "routing proof");
    assert.equal(commentId, 12345);

    const issueViewCalls = calls.filter((c) => c[1] === "issue" && c[2] === "view");
    assert.ok(issueViewCalls.length >= 2, "expected issue view calls for read + transition validation");
    for (const call of issueViewCalls) {
      assert.deepEqual(call.slice(-2), ["--repo", "yaqub0r/devclaw"]);
    }

    const issueEditCalls = calls.filter((c) => c[1] === "issue" && c[2] === "edit");
    assert.ok(issueEditCalls.length >= 1, "expected issue edit calls during transition");
    for (const call of issueEditCalls) {
      assert.deepEqual(call.slice(-2), ["--repo", "yaqub0r/devclaw"]);
    }

    const labelCreateCall = calls.find((c) => c[1] === "label" && c[2] === "create");
    assert.ok(labelCreateCall, "expected label create call");
    assert.deepEqual(labelCreateCall.slice(-2), ["--repo", "yaqub0r/devclaw"]);

    const commentCall = calls.find((c) => c[1] === "api" && c[2] === "repos/:owner/:repo/issues/95/comments");
    assert.ok(commentCall, "expected issue comment api call");
    assert.deepEqual(commentCall.slice(-2), ["--repo", "yaqub0r/devclaw"]);
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
