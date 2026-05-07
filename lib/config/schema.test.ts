import { describe, it } from "node:test";
import assert from "node:assert";
import { validateWorkflowIntegrity } from "./schema.js";
import { DEFAULT_WORKFLOW } from "../workflow/index.js";

describe("validateWorkflowIntegrity delivery phase validation", () => {
  it("rejects promotion states that do not belong to reviewer", () => {
    const errors = validateWorkflowIntegrity({
      ...DEFAULT_WORKFLOW,
      delivery: {
        ...DEFAULT_WORKFLOW.delivery,
        promotion: {
          ...DEFAULT_WORKFLOW.delivery?.promotion,
          queueState: "toTest",
        },
      },
    });

    assert.ok(errors.includes("workflow.delivery.promotion.queueState must reference a reviewer queue state"));
  });

  it("rejects acceptance states that do not belong to tester", () => {
    const errors = validateWorkflowIntegrity({
      ...DEFAULT_WORKFLOW,
      delivery: {
        ...DEFAULT_WORKFLOW.delivery,
        acceptance: {
          ...DEFAULT_WORKFLOW.delivery?.acceptance,
          activeState: "promoting",
        },
      },
    });

    assert.ok(errors.includes("workflow.delivery.acceptance.activeState must reference a tester active state"));
  });
});
