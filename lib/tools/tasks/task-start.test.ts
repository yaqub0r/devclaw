import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StateType } from "../../workflow/types.js";
import { assertExplicitHoldRestart, resolveTarget } from "./task-start.js";
import { DEFAULT_WORKFLOW } from "../../workflow/defaults.js";

describe("task_start", () => {
  it("requires explicit confirmation to restart an issue from Refining", () => {
    assert.throws(
      () => assertExplicitHoldRestart(42, DEFAULT_WORKFLOW, "Refining", { label: "Refining", type: StateType.HOLD, description: "hold", color: "#000000" }, false),
      /confirmHoldRestart: true/,
    );
  });

  it("allows the normal Planning start path without confirmHoldRestart", () => {
    assert.doesNotThrow(() => {
      assertExplicitHoldRestart(42, DEFAULT_WORKFLOW, "Planning", DEFAULT_WORKFLOW.states.planning!, false);
    });
  });

  it("allows explicit restart from Refining when confirmHoldRestart is true", () => {
    assert.doesNotThrow(() => {
      assertExplicitHoldRestart(42, DEFAULT_WORKFLOW, "Refining", { label: "Refining", type: StateType.HOLD, description: "hold", color: "#000000" }, true);
    });
  });

  it("resolves Refining to the developer queue when restart is explicitly confirmed", () => {
    const target = resolveTarget(
      DEFAULT_WORKFLOW,
      "Refining",
      DEFAULT_WORKFLOW.states.refining!,
    );

    assert.equal(target.transitioned, true);
    assert.equal(target.targetLabel, "To Do");
  });
});
