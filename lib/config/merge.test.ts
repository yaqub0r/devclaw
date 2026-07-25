import { describe, it } from "node:test";
import assert from "node:assert";
import { mergeConfig } from "./merge.js";

describe("mergeConfig deployment merging", () => {
  it("deep-merges individual deployment lane objects", () => {
    const merged = mergeConfig({
      deployment: {
        lanes: {
          production: {
            aliases: ["prod"],
            protected: true,
            rollbackTargets: ["staging"],
          },
        },
      },
    }, {
      deployment: {
        lanes: {
          production: {
            humanOnly: true,
          },
        },
      },
    });

    assert.deepStrictEqual(merged.deployment?.lanes?.production, {
      aliases: ["prod"],
      protected: true,
      rollbackTargets: ["staging"],
      humanOnly: true,
    });
  });

  it("deep-merges deployment workflow state objects", () => {
    const merged = mergeConfig({
      deployment: {
        workflow: {
          states: {
            promoting: {
              action: "promote",
              sourceLane: "build",
              targetLane: "staging",
              issueLinkage: "workflow",
            },
          },
        },
      },
    }, {
      deployment: {
        workflow: {
          states: {
            promoting: {
              issueLinkage: "comment",
            } as any,
          },
        },
      },
    });

    assert.deepStrictEqual(merged.deployment?.workflow?.states?.promoting, {
      action: "promote",
      sourceLane: "build",
      targetLane: "staging",
      issueLinkage: "comment",
    });
  });
});
