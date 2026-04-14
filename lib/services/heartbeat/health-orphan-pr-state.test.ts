import { describe, it } from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { scanOrphanedLabels } from "./health.js";
import { TestProvider } from "../../testing/test-provider.js";
import { DEFAULT_WORKFLOW } from "../../workflow/index.js";
import { PrState } from "../../providers/provider.js";
import type { Project } from "../../projects/types.js";

function project(): Project {
  return {
    slug: "devclaw",
    name: "devclaw",
    repo: "/tmp/repo",
    groupName: "DevClaw",
    deployUrl: "",
    baseBranch: "main",
    deployBranch: "main",
    channels: [],
    workers: {
      developer: { levels: { junior: [{ active: false, issueId: null, sessionKey: null, startTime: null }] } },
    },
  };
}

describe("scanOrphanedLabels PR-state reconciliation", () => {
  it("moves orphaned developer work with an open PR back to To Review", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "health-orphan-open-pr-"));
    try {
      const provider = new TestProvider();
      provider.seedIssue({ iid: 42, title: "Open PR", labels: ["Doing"] });
      provider.setPrStatus(42, { state: PrState.OPEN, url: "https://github.com/test/repo/pull/42" });

      const fixes = await scanOrphanedLabels({
        workspaceDir,
        projectSlug: "devclaw",
        project: project(),
        role: "developer",
        autoFix: true,
        provider,
        workflow: DEFAULT_WORKFLOW,
      });

      assert.strictEqual(fixes[0]?.labelReverted, "Doing → To Review");
      assert.ok((await provider.getIssue(42)).labels.includes("To Review"));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("moves orphaned developer work with ambiguous PRs to To Improve", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "health-orphan-ambiguous-pr-"));
    try {
      const provider = new TestProvider();
      provider.seedIssue({ iid: 43, title: "Ambiguous PRs", labels: ["Doing"] });
      provider.setPrStatus(43, {
        state: PrState.OPEN,
        url: "https://github.com/test/repo/pull/43",
        ambiguous: true,
        reason: "multiple_open_prs",
        candidates: [
          { url: "https://github.com/test/repo/pull/41", state: "OPEN" },
          { url: "https://github.com/test/repo/pull/43", state: "OPEN" },
        ],
      });

      const fixes = await scanOrphanedLabels({
        workspaceDir,
        projectSlug: "devclaw",
        project: project(),
        role: "developer",
        autoFix: true,
        provider,
        workflow: DEFAULT_WORKFLOW,
      });

      assert.strictEqual(fixes[0]?.labelReverted, "Doing → To Improve");
      assert.ok((await provider.getIssue(43)).labels.includes("To Improve"));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
