import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { createTestHarness, type TestHarness } from "../testing/index.js";
import { executeCompletion } from "./pipeline.js";
import { DEFAULT_WORKFLOW, getCurrentCandidate } from "../workflow/index.js";

describe("executeCompletion delivery provenance", () => {
  let h: TestHarness;

  afterEach(async () => {
    if (h) await h.cleanup();
  });

  it("records an active candidate when promotion completes into acceptance", async () => {
    h = await createTestHarness({
      workers: {
        reviewer: { active: true, issueId: "26", level: "junior" },
      },
    });
    h.provider.seedIssue({ iid: 26, title: "Promote PR", labels: ["Promoting"] });

    const output = await executeCompletion({
      workspaceDir: h.workspaceDir,
      projectSlug: h.project.slug,
      channels: h.project.channels,
      role: "reviewer",
      result: "approve",
      issueId: 26,
      summary: "Promoted candidate",
      provider: h.provider,
      repoPath: "/tmp/test-repo",
      projectName: "test-project",
      workflow: DEFAULT_WORKFLOW,
      runCommand: h.runCommand,
    });

    assert.strictEqual(output.labelTransition, "Promoting → To Accept");
    const candidate = await getCurrentCandidate(h.provider, 26);
    assert.ok(candidate, "Expected candidate provenance to be recorded");
    assert.strictEqual(candidate?.status, "active");
  });
});
