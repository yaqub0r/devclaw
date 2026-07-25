import { describe, expect, it } from "vitest";
import { buildTaskMessage } from "./message-builder.js";

describe("buildTaskMessage", () => {
  it("includes checkout contract with target ref and sha", () => {
    const msg = buildTaskMessage({
      projectName: "devclaw",
      channelId: "-100",
      role: "tester",
      issueId: 171,
      issueTitle: "Pin validation checkout",
      issueDescription: "Make validation deterministic",
      issueUrl: "https://example.com/issues/171",
      repo: "/tmp/devclaw",
      baseBranch: "main",
      checkoutContract: {
        targetBranch: "issue/171-checkout-contract-validation",
        expectedWorktreePath: "/tmp/devclaw.worktrees/issue/171-checkout-contract-validation",
        targetRef: "origin/main",
        targetSha: "24164242926923d9accc44cfa65892c1506e77d8",
        requiredCleanTree: true,
        requireIsolatedWorktree: true,
        decisiveVerdictRequiresMatch: true,
      },
    });

    expect(msg).toContain("## Required Checkout Contract");
    expect(msg).toContain("Target branch: `issue/171-checkout-contract-validation`");
    expect(msg).toContain("Expected worktree path: `/tmp/devclaw.worktrees/issue/171-checkout-contract-validation`");
    expect(msg).toContain("Target ref: `origin/main`");
    expect(msg).toContain("Target commit: `24164242926923d9accc44cfa65892c1506e77d8`");
    expect(msg).toContain("git rev-parse HEAD");
    expect(msg).toContain("git status --short");
    expect(msg).toContain("Use an isolated worktree or other clean checkout");
  });
});
