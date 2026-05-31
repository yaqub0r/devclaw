import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchPrContext, fetchPrFeedback, formatPrFeedback, type PrFeedback } from "./pr-context.js";
import { TestProvider } from "../testing/test-provider.js";
import { PrState } from "../providers/provider.js";
import { recordCanonicalPr } from "../services/canonical-pr.js";

describe("formatPrFeedback", () => {
  it("preserves canonical PR context even when no comments were retrieved", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/123-test",
      reason: "merge_conflict",
      comments: [],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");
    assert.match(text, /https:\/\/github.com\/user\/repo\/pull\/123/);
    assert.match(text, /No review comment bodies were retrieved/);
    assert.match(text, /feature\/123-test/);
  });

  it("includes branch name in conflict resolution instructions", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/456-test",
      reason: "merge_conflict",
      comments: [
        {
          id: 1,
          author: "reviewer",
          body: "Conflicts detected",
          state: "COMMENTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.match(text, /feature\/456-test/);
    assert.match(text, /🔹 Branch: `feature\/456-test`/);
    assert.match(text, /git checkout feature\/456-test/);
    assert.match(text, /git push --force-with-lease origin feature\/456-test/);
  });

  it("uses fallback branch name when not provided", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      reason: "merge_conflict",
      comments: [
        {
          id: 1,
          author: "reviewer",
          body: "Conflicts detected",
          state: "COMMENTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.match(text, /your-branch/);
    assert.match(text, /🔹 Branch: `your-branch`/);
  });

  it("includes step-by-step instructions for conflict resolution", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/123-fix",
      reason: "merge_conflict",
      comments: [
        {
          id: 1,
          author: "reviewer",
          body: "Fix the conflicts",
          state: "COMMENTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "develop");
    const text = result.join("\n");

    assert.match(text, /1\. Fetch and check out the PR branch/);
    assert.match(text, /2\. Rebase onto `develop`/);
    assert.match(text, /3\. Resolve any conflicts/);
    assert.match(text, /4\. Force-push to the SAME branch/);
    assert.match(text, /5\. Verify the PR shows as mergeable/);
    assert.match(text, /⚠️ Do NOT create a new PR/);
    assert.match(text, /Do NOT switch branches/);
    assert.match(text, /Update THIS canonical PR only/);
  });

  it("correctly formats changes_requested feedback", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/456",
      branchName: "feature/789-feature",
      reason: "changes_requested",
      comments: [
        {
          id: 1,
          author: "reviewer",
          body: "Please make these changes",
          state: "CHANGES_REQUESTED",
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.match(text, /⚠️ Changes were requested/);
    assert.match(text, /Please make these changes/);
    assert.doesNotMatch(text, /Conflict Resolution Instructions/);
  });

  it("includes comment location information when available", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/456-test",
      reason: "changes_requested",
      comments: [
        {
          id: 1,
          author: "reviewer",
          body: "Fix this logic",
          state: "CHANGES_REQUESTED",
          path: "src/index.ts",
          line: 42,
        },
      ],
    };
    const result = formatPrFeedback(feedback, "main");
    const text = result.join("\n");

    assert.match(text, /\(src\/index\.ts:42\)/);
  });

  it("uses correct base branch in rebase command", () => {
    const feedback: PrFeedback = {
      url: "https://github.com/user/repo/pull/123",
      branchName: "feature/test",
      reason: "merge_conflict",
      comments: [
        {
          id: 1,
          author: "reviewer",
          body: "Conflicts",
          state: "COMMENTED",
        },
      ],
    };

    let result = formatPrFeedback(feedback, "main");
    let text = result.join("\n");
    assert.match(text, /git rebase main/);

    result = formatPrFeedback(feedback, "develop");
    text = result.join("\n");
    assert.match(text, /git rebase develop/);
  });
});

describe("canonical PR dispatch routing", () => {
  it("fails closed when canonical status lookup no longer resolves", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "devclaw-pr-context-"));
    try {
      const provider = new TestProvider();
      provider.seedIssue({ iid: 77, title: "Review me", labels: ["To Review"] });
      provider.setLinkedPrs(77, [{ number: 77, url: "https://example.com/pr/77", title: "Review me", sourceBranch: "issue/77-review-me" }]);
      await recordCanonicalPr(workspaceDir, "test-project", 77, {
        number: 77,
        url: "https://example.com/pr/77",
        title: "Review me",
        sourceBranch: "issue/77-review-me",
      }, PrState.OPEN);

      await assert.rejects(
        () => fetchPrContext(provider, 77, { workspaceDir, projectSlug: "test-project" }),
        /stored PR https:\/\/example\.com\/pr\/77 no longer resolves/,
      );
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves canonical feedback routing even when comments are empty", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "devclaw-pr-feedback-"));
    try {
      const provider = new TestProvider();
      provider.seedIssue({ iid: 78, title: "Needs changes", labels: ["To Improve"] });
      provider.setPrStatus(78, {
        state: PrState.CHANGES_REQUESTED,
        url: "https://example.com/pr/78",
        number: 78,
        sourceBranch: "issue/78-needs-changes",
      });
      await recordCanonicalPr(workspaceDir, "test-project", 78, {
        number: 78,
        url: "https://example.com/pr/78",
        title: "Needs changes",
        sourceBranch: "issue/78-needs-changes",
      }, PrState.CHANGES_REQUESTED);

      const feedback = await fetchPrFeedback(provider, 78, { workspaceDir, projectSlug: "test-project" });
      assert.ok(feedback);
      assert.strictEqual(feedback?.url, "https://example.com/pr/78");
      assert.strictEqual(feedback?.reason, "changes_requested");
      assert.deepStrictEqual(feedback?.comments, []);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
