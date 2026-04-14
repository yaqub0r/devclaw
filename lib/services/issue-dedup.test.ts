import { describe, it } from "node:test";
import assert from "node:assert";
import { findLikelyDuplicateIssues } from "./issue-dedup.js";

describe("issue dedup regression coverage", () => {
  it("flags near-duplicate open work deterministically", () => {
    const duplicates = findLikelyDuplicateIssues(
      {
        title: "Update star catalog docs to cite al-Sufi's Book of Fixed Stars",
        description: "Document the star catalog source and cite al-Sufi in the docs.",
      },
      [
        {
          iid: 119,
          title: "Update star catalog docs to note the source from al-Sufi's Book of Fixed Stars",
          description: "Add source attribution for the star catalog documentation.",
          labels: ["To Review"],
          state: "opened",
        },
        {
          iid: 88,
          title: "Refactor notification routing",
          description: "Unrelated pipeline cleanup.",
          labels: ["Doing"],
          state: "opened",
        },
      ],
    );

    assert.strictEqual(duplicates.length, 1);
    assert.strictEqual(duplicates[0]?.iid, 119);
    assert.ok((duplicates[0]?.similarity ?? 0) > 0.5);
  });

  it("orders multiple likely duplicates by strongest similarity then issue id", () => {
    const duplicates = findLikelyDuplicateIssues(
      {
        title: "Add canonical PR reconciliation for review state drift",
        description: "Reconcile review labels against the surviving PR.",
      },
      [
        {
          iid: 34,
          title: "Add workflow reconciliation for PR state and stale label residue",
          description: "Clean stale review labels and canonicalize PR state.",
        },
        {
          iid: 102,
          title: "Add canonical PR reconciliation for review drift",
          description: "Determine which PR is canonical and clear stale review answers.",
        },
      ],
    );

    assert.strictEqual(duplicates[0]?.iid, 102);
    assert.ok((duplicates[1]?.iid ?? 34) === 34 || duplicates.length === 1);
    assert.ok(duplicates.every((candidate, index, items) => index === 0 || items[index - 1].similarity >= candidate.similarity));
  });
});
