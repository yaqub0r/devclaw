import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRepoTarget } from "./helpers.js";

describe("normalizeRepoTarget", () => {
  it("normalizes github https and ssh remotes", () => {
    assert.equal(normalizeRepoTarget("https://github.com/yaqub0r/devclaw.git"), "yaqub0r/devclaw");
    assert.equal(normalizeRepoTarget("git@github.com:yaqub0r/devclaw.git"), "yaqub0r/devclaw");
  });

  it("normalizes gitlab remotes and trims whitespace", () => {
    assert.equal(normalizeRepoTarget("  https://gitlab.com/group/project.git  "), "group/project");
  });

  it("preserves already-normalized owner repo targets", () => {
    assert.equal(normalizeRepoTarget("yaqub0r/devclaw"), "yaqub0r/devclaw");
  });
});
