import { describe, it } from "node:test";
import assert from "node:assert";
import { DEFAULT_WORKFLOW } from "../workflow/index.js";
import { staleWorkflowLabelsForTransition } from "./workflow-normalization.js";

describe("workflow normalization regression coverage", () => {
  it("clears stale review and worker residue when entering Refining", () => {
    const stale = staleWorkflowLabelsForTransition(
      ["Refining", "review:human", "test:skip", "developer:junior:Goldia", "owner:sai"],
      "Refining",
      DEFAULT_WORKFLOW,
    );

    assert.deepStrictEqual(stale, ["review:human", "test:skip", "developer:junior:Goldia"]);
  });

  it("keeps routing labels while the issue remains in active review flow", () => {
    const stale = staleWorkflowLabelsForTransition(
      ["To Review", "review:human", "developer:senior:Ada"],
      "To Review",
      DEFAULT_WORKFLOW,
    );

    assert.deepStrictEqual(stale, []);
  });
});
