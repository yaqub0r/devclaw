import { describe, it, expect } from "vitest";
import { buildTaskMessage } from "./message-builder.js";
import type { IssueCheckoutContract } from "../projects/types.js";

const contract: IssueCheckoutContract = {
  issueId: 174,
  mode: "issue",
  repoPath: "/repo",
  canonicalBranch: "issue/174-canonical-checkout-contract",
  canonicalWorktreePath: "/repo.worktrees/issue/174-canonical-checkout-contract",
  baseBranch: "devclaw-local-dev",
  baseWorktreePath: "/repo.worktrees/devclaw-local-dev",
  targetRef: "devclaw-local-dev",
  targetSha: "abc123",
  requiredCleanliness: "clean",
  status: "verified",
  lastVerifiedProvenance: {
    verifiedAt: "2026-05-05T00:00:00Z",
    path: "/repo.worktrees/issue/174-canonical-checkout-contract",
    branch: "issue/174-canonical-checkout-contract",
    headSha: "abc123",
    clean: true,
    status: "verified",
  },
};

describe("buildTaskMessage", () => {
  it("renders the canonical checkout contract and validation lane distinction", () => {
    const msg = buildTaskMessage({
      projectName: "devclaw",
      channelId: "-100",
      role: "developer",
      issueId: 174,
      issueTitle: "Implement canonical issue checkout contract",
      issueDescription: "Do the work.",
      issueUrl: "https://example.com/issues/174",
      repo: "/repo",
      baseBranch: "devclaw-local-current",
      checkoutContract: contract,
      resolvedRole: { completionResults: ["done", "blocked"] } as any,
    });

    expect(msg).toContain("## Canonical Checkout Contract");
    expect(msg).toContain("Required worktree: `/repo.worktrees/issue/174-canonical-checkout-contract`");
    expect(msg).toContain("Required branch: `issue/174-canonical-checkout-contract`");
    expect(msg).toContain("Base branch: `devclaw-local-dev`");
    expect(msg).toContain("Allowed derived validation lane");
  });
});
