import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIssueBranchName, buildWorktreePath, buildBootstrapContractSection } from "./worktree-bootstrap.js";

describe("worktree bootstrap contract", () => {
  it("builds canonical issue branch names", () => {
    assert.equal(
      buildIssueBranchName(238, "Auto-bootstrap worker issue worktrees and separate environment/setup failures"),
      "issue/238-auto-bootstrap-worker-issue-worktrees-and-separa"
    );
  });

  it("builds worktree path from repo and branch", () => {
    assert.equal(
      buildWorktreePath("/repo/devclaw", "issue/238-example"),
      "/repo/devclaw.worktrees/issue/238-example"
    );
  });

  it("includes dependency strategy and failure classes", () => {
    const section = buildBootstrapContractSection({
      repo: "/repo/devclaw",
      baseBranch: "devclaw-local-dev",
      role: "developer",
      issueId: 238,
      issueTitle: "Bootstrap worker issue worktrees",
    }).join("\n");

    assert.match(section, /per-worktree install/);
    assert.match(section, /npm run build/);
    assert.match(section, /ambient validation noise/);
    assert.match(section, /environment\/bootstrap failure/);
  });
});
