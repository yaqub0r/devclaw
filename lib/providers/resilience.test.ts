import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { BrokenCircuitError } from "cockatiel";
import { getProviderPolicy, resetProviderPoliciesForTest, withResilience } from "./resilience.js";

afterEach(() => {
  resetProviderPoliciesForTest();
});

describe("provider resilience scoping", () => {
  it("opens the breaker only for the failing scope", async () => {
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(
        withResilience("github:/repo-a", async () => {
          throw new Error(`repo A failure ${i}`);
        }),
      );
    }

    await assert.rejects(
      withResilience("github:/repo-a", async () => "should not run"),
      BrokenCircuitError,
    );

    const result = await withResilience("github:/repo-b", async () => "repo-b-ok");
    assert.strictEqual(result, "repo-b-ok");
  });

  it("reuses breaker state within the same scope", async () => {
    const scopedPolicy = getProviderPolicy("github:/repo-a", {
      consecutiveFailures: 2,
      halfOpenAfter: 60_000,
    });

    for (let i = 0; i < 2; i += 1) {
      await assert.rejects(
        scopedPolicy.execute(async () => {
          throw new Error(`same repo failure ${i}`);
        }),
      );
    }

    await assert.rejects(
      scopedPolicy.execute(async () => "should not run"),
      BrokenCircuitError,
    );

    await assert.rejects(
      withResilience("github:/repo-a", async () => "should still be blocked"),
      BrokenCircuitError,
    );
  });
});
