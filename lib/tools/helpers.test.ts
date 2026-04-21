import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRepoTarget } from "./helpers.js";

describe("normalizeRepoTarget", () => {
  it("normalizes github https and ssh remotes", () => {
    assert.equal(normalizeRepoTarget("https://github.com/example-owner/example-repo.git"), "example-owner/example-repo");
    assert.equal(normalizeRepoTarget("git@github.com:example-owner/example-repo.git"), "example-owner/example-repo");
  });

  it("normalizes gitlab remotes and trims whitespace", () => {
    assert.equal(normalizeRepoTarget("  https://gitlab.com/group/project.git  "), "group/project");
  });

  it("preserves already-normalized owner repo targets", () => {
    assert.equal(normalizeRepoTarget("example-owner/example-repo"), "example-owner/example-repo");
  });
});
