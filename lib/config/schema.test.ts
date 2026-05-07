import { describe, it } from "node:test";
import assert from "node:assert";
import { validateWorkflowIntegrity } from "./schema.js";
import { DEFAULT_WORKFLOW } from "../workflow/index.js";

describe("validateWorkflowIntegrity delivery role validation", () => {
  it("rejects promotion states that are not reviewer-owned", () => {
    const workflow = structuredClone(DEFAULT_WORKFLOW);
    workflow.delivery!.promotion!.queueState = "toTest";
    workflow.delivery!.promotion!.activeState = "testing";

    const errors = validateWorkflowIntegrity(workflow);

    assert.ok(errors.includes("workflow.delivery.promotion.queueState must reference a reviewer-owned state"));
    assert.ok(errors.includes("workflow.delivery.promotion.activeState must reference a reviewer-owned state"));
  });

  it("rejects acceptance states that are not tester-owned", () => {
    const workflow = structuredClone(DEFAULT_WORKFLOW);
    workflow.delivery!.acceptance!.queueState = "toReview";
    workflow.delivery!.acceptance!.activeState = "promoting";

    const errors = validateWorkflowIntegrity(workflow);

    assert.ok(errors.includes("workflow.delivery.acceptance.queueState must reference a tester-owned state"));
    assert.ok(errors.includes("workflow.delivery.acceptance.activeState must reference a tester-owned state"));
  });
});
