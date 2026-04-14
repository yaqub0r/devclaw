/**
 * Tests for duplicate issue preflight detection.
 *
 * Run with: npx tsx --test lib/services/issue-dedup.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { findDuplicateCandidates, buildDuplicateConfirmationMessage } from "./issue-dedup.js";
import { DEFAULT_WORKFLOW } from "../workflow/index.js";
import type { Issue } from "../providers/provider.js";

function issue(overrides: Partial<Issue> & { iid: number; title: string }): Issue {
  return {
    iid: overrides.iid,
    title: overrides.title,
    description: overrides.description ?? "",
    labels: overrides.labels ?? ["Planning"],
    state: overrides.state ?? "opened",
    web_url: overrides.web_url ?? `https://example.com/issues/${overrides.iid}`,
  };
}

describe("findDuplicateCandidates", () => {
  it("classifies obvious duplicate titles as high confidence", () => {
    const result = findDuplicateCandidates(
      {
        title: "Update star catalog docs to cite al-Sufi's Book of Fixed Stars",
        description: "Document the source in the star catalog docs.",
      },
      [
        issue({
          iid: 119,
          title: "Update star catalog docs to note the source from al-Sufi's Book of Fixed Stars",
          description: "Please cite the historical source in the star catalog docs.",
          labels: ["Doing"],
        }),
      ],
      DEFAULT_WORKFLOW,
    );

    assert.strictEqual(result.confidence, "high");
    assert.strictEqual(result.shouldRequireConfirmation, true);
    assert.strictEqual(result.shouldBlockWithoutConfirmation, true);
    assert.strictEqual(result.candidates[0]?.issueId, 119);
    assert.ok(result.candidates[0]?.reasons.some((reason) => reason.includes("shared title tokens")));
  });

  it("classifies partial overlap as medium confidence", () => {
    const result = findDuplicateCandidates(
      {
        title: "Add duplicate issue detection before creating tasks",
        description: "Compare new tasks against open work before creating them.",
      },
      [
        issue({
          iid: 32,
          title: "Research duplicate issue detection before task creation",
          description: "Analyze how to compare new issues with open work.",
          labels: ["Planning"],
        }),
      ],
      DEFAULT_WORKFLOW,
    );

    assert.strictEqual(result.confidence, "medium");
    assert.strictEqual(result.shouldRequireConfirmation, true);
    assert.strictEqual(result.candidates[0]?.issueId, 32);
  });

  it("ignores unrelated issues and terminal-state issues", () => {
    const result = findDuplicateCandidates(
      {
        title: "Implement SSH key rotation reminders",
        description: "Add reminder scheduling for stale SSH keys.",
      },
      [
        issue({ iid: 7, title: "Improve release notes formatting", labels: ["Planning"] }),
        issue({ iid: 8, title: "Implement SSH key rotation reminders", labels: ["Done"], state: "closed" }),
      ],
      DEFAULT_WORKFLOW,
    );

    assert.strictEqual(result.confidence, "low");
    assert.strictEqual(result.shouldRequireConfirmation, false);
    assert.deepStrictEqual(result.candidates, []);
  });

  it("orders candidates deterministically by confidence, score, then issue id", () => {
    const result = findDuplicateCandidates(
      {
        title: "Normalize duplicate issue detection results",
        description: "Keep duplicate warnings deterministic.",
      },
      [
        issue({ iid: 20, title: "Normalize duplicate issue detection output", labels: ["Planning"] }),
        issue({ iid: 11, title: "Normalize duplicate issue detection results", labels: ["To Do"] }),
        issue({ iid: 15, title: "Duplicate issue warning normalization", labels: ["Doing"] }),
      ],
      DEFAULT_WORKFLOW,
    );

    assert.deepStrictEqual(result.candidates.map((candidate) => candidate.issueId), [11, 20]);
  });
});

describe("buildDuplicateConfirmationMessage", () => {
  it("includes issue ids, links, scores, and reasons", () => {
    const check = findDuplicateCandidates(
      {
        title: "Update star catalog docs to cite al-Sufi's Book of Fixed Stars",
        description: "Document the historical source in the docs.",
      },
      [
        issue({
          iid: 119,
          title: "Update star catalog docs to note the source from al-Sufi's Book of Fixed Stars",
          description: "Document the source in the star catalog docs.",
          labels: ["Doing"],
        }),
      ],
      DEFAULT_WORKFLOW,
    );

    const message = buildDuplicateConfirmationMessage(check);
    assert.ok(message.includes("Possible duplicate detected") || message.includes("Confirm before creating"));
    assert.ok(message.includes("#119"));
    assert.ok(message.includes("https://example.com/issues/119"));
    assert.ok(message.includes("score"));
    assert.ok(message.includes("Reasons:"));
  });
});
