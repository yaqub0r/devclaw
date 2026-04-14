import { describe, it } from "node:test";
import assert from "node:assert";
import { TestProvider } from "../testing/test-provider.js";
import { DEFAULT_WORKFLOW } from "../workflow/index.js";
import { PrState } from "../providers/provider.js";
import { getCanonicalReviewStatus, getStaleReviewLabels } from "./pr-reconciliation.js";

describe("pr reconciliation", () => {
  it("treats stale review labels as residue once feedback exists", async () => {
    const provider = new TestProvider({ workflow: DEFAULT_WORKFLOW });
    const issue = provider.seedIssue({ iid: 131, title: "Residue", labels: ["To Improve", "review:human"] });
    provider.setPrStatus(131, { state: PrState.CHANGES_REQUESTED, url: "https://example.com/pr/131" });

    const review = await getCanonicalReviewStatus(provider, DEFAULT_WORKFLOW, issue);

    assert.strictEqual(review.canonicalState, "changes_requested");
    assert.deepStrictEqual(getStaleReviewLabels(issue, review), ["review:human"]);
  });

  it("surfaces ambiguity when multiple PRs exist", async () => {
    const provider = new TestProvider({ workflow: DEFAULT_WORKFLOW });
    const issue = provider.seedIssue({ iid: 34, title: "Ambiguous", labels: ["To Review", "review:human"] });
    provider.setPrStatus(34, {
      state: PrState.OPEN,
      url: null,
      ambiguous: true,
      reason: "multiple_open_prs",
      candidates: [
        { url: "https://example.com/pr/1", state: "OPEN" },
        { url: "https://example.com/pr/2", state: "OPEN" },
      ],
    });

    const review = await getCanonicalReviewStatus(provider, DEFAULT_WORKFLOW, issue);

    assert.strictEqual(review.ambiguous, true);
    assert.strictEqual(review.canonicalState, "ambiguous");
    assert.strictEqual(review.needsHumanReview, false);
  });
});
