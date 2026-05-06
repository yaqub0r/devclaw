import { describe, it, expect } from "vitest";
import { resolveExpectedCheckoutContract } from "./checkout-contract.js";

describe("resolveExpectedCheckoutContract", () => {
  it("routes normal devclaw issue work to devclaw-local-dev and issue/*", () => {
    const contract = resolveExpectedCheckoutContract({
      project: {
        slug: "devclaw",
        name: "devclaw",
        repo: "/home/sai/git/devclaw.worktrees/devclaw-local-current",
        groupName: "DevClaw",
        deployUrl: "",
        baseBranch: "devclaw-local-current",
        deployBranch: "devclaw-local-current",
        channels: [],
        workers: {},
        issueCheckouts: {},
      },
      issueId: 174,
      issueTitle: "Implement canonical issue checkout contract",
      repoPath: "/home/sai/git/devclaw.worktrees/devclaw-local-current",
      role: "developer",
    });

    expect(contract.mode).toBe("issue");
    expect(contract.baseBranch).toBe("devclaw-local-dev");
    expect(contract.canonicalBranch).toBe("issue/174-implement-canonical-issue-checkout-contract");
    expect(contract.canonicalWorktreePath).toContain(".worktrees/issue/174-implement-canonical-issue-checkout-contract");
  });
});
