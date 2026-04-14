import { describe, it } from "node:test";
import assert from "node:assert";
import { PrState, type Issue } from "../providers/provider.js";
import { DEFAULT_WORKFLOW } from "./index.js";
import {
  findSemanticDuplicateIssues,
  getNonTerminalStateLabels,
  summarizePrDrift,
  tokenizeSemanticText,
} from "./integrity.js";

describe("workflow integrity helpers", () => {
  it("finds semantically overlapping open issues", () => {
    const issues: Issue[] = [
      {
        iid: 119,
        title: "Update star catalog docs to note the source from al-Sufi's Book of Fixed Stars",
        description: "Document the provenance for the star catalog.",
        labels: ["Planning"],
        state: "opened",
        web_url: "https://example.com/issues/119",
      },
      {
        iid: 131,
        title: "Remove legacy publish reference",
        description: "Unrelated cleanup",
        labels: ["Planning"],
        state: "opened",
        web_url: "https://example.com/issues/131",
      },
    ];

    const duplicates = findSemanticDuplicateIssues({
      title: "Update star catalog docs to cite al-Sufi's Book of Fixed Stars",
      description: "Clarify the same provenance in the docs",
    }, issues);

    assert.equal(duplicates[0]?.issue.iid, 119);
    assert.ok((duplicates[0]?.score ?? 0) >= 0.45);
  });

  it("ignores generic stop words while tokenizing", () => {
    const tokens = tokenizeSemanticText("Update the docs to cite the source from al-Sufi");
    assert.ok(tokens.includes("alsufi"));
    assert.ok(!tokens.includes("update"));
    assert.ok(!tokens.includes("docs"));
  });

  it("returns all non-terminal workflow labels", () => {
    const labels = getNonTerminalStateLabels(DEFAULT_WORKFLOW);
    assert.ok(labels.includes("Planning"));
    assert.ok(labels.includes("To Review"));
    assert.ok(!labels.includes("Done"));
  });

  it("marks the strongest linked PR as canonical and detects duplicate active PRs", () => {
    const drift = summarizePrDrift([
      { state: PrState.OPEN, url: "https://example.com/pr/38", mergeable: false },
      { state: PrState.APPROVED, url: "https://example.com/pr/39", mergeable: true },
      { state: PrState.CLOSED, url: "https://example.com/pr/40" },
    ]);

    assert.equal(drift.canonical?.url, "https://example.com/pr/39");
    assert.equal(drift.hasMultipleActive, true);
    assert.equal(drift.hasDirtyReviewState, true);
  });
});
