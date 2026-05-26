import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveLaneAlias, validateRollbackLegality, withLegacyDeploymentDefaults } from "./resolve.js";

const config = {
  lanes: {
    build: { aliases: ["candidate"] },
    staging: { aliases: ["stage"], rollbackTargets: ["build"] },
    production: { aliases: ["prod"], rollbackTargets: ["staging"] },
  },
  commands: {},
  transitions: [],
};

describe("deployer resolve helpers", () => {
  it("resolves lane aliases", () => {
    assert.equal(resolveLaneAlias(config, "stage"), "staging");
    assert.equal(resolveLaneAlias(config, "production"), "production");
    assert.equal(resolveLaneAlias(config, "missing"), null);
  });

  it("validates rollback legality with source as the rolled back lane and target as the destination lane", () => {
    assert.doesNotThrow(() => validateRollbackLegality(config, "staging", "build"));
    assert.throws(() => validateRollbackLegality(config, "production", "build"), /not allowed/);
    assert.throws(() => validateRollbackLegality(config, null, "build"), /requires sourceLane/);
  });

  it("backfills legacy deployment defaults", () => {
    const legacy = withLegacyDeploymentDefaults({}, { name: "p", deployBranch: "main", deployUrl: "https://example.com" } as any);
    assert.ok(legacy.transitions?.some((transition) => transition.action === "deploy"));
    assert.ok(legacy.commands?.legacyDeploy);
    assert.ok(legacy.commands?.legacyPromote);
    assert.ok(legacy.lanes?.default);
  });
});
