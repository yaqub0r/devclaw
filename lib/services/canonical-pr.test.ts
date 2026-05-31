import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrState } from "../providers/provider.js";
import { TestProvider } from "../testing/test-provider.js";
import { loadCanonicalPrRecord, recordCanonicalPr, refreshCanonicalPrStatus, resolveCanonicalPrForIssue } from "./canonical-pr.js";

const temps: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "canonical-pr-test-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("canonical-pr ledger", () => {
  it("records superseded canonical PRs when a replacement is recorded", async () => {
    const workspaceDir = await makeWorkspace();

    await recordCanonicalPr(workspaceDir, "test-project", 244, {
      number: 245,
      url: "https://example.com/pr/245",
      sourceBranch: "issue/244-canonical-pr-ledger",
      repo: "owner/repo",
    }, PrState.OPEN);

    const replacement = await recordCanonicalPr(workspaceDir, "test-project", 244, {
      number: 246,
      url: "https://example.com/pr/246",
      sourceBranch: "issue/244-canonical-pr-ledger-v2",
      repo: "owner/repo",
    }, PrState.OPEN);

    assert.equal(replacement.url, "https://example.com/pr/246");
    assert.equal(replacement.supersededPrs.length, 1);
    assert.equal(replacement.supersededPrs[0]?.url, "https://example.com/pr/245");
    assert.equal(replacement.supersededPrs[0]?.reason, "replacement");
  });

  it("refreshes canonical PR status without clobbering supersession history", async () => {
    const workspaceDir = await makeWorkspace();

    await recordCanonicalPr(workspaceDir, "test-project", 244, {
      number: 245,
      url: "https://example.com/pr/245",
      sourceBranch: "issue/244-canonical-pr-ledger",
      repo: "owner/repo",
    }, PrState.OPEN);
    await recordCanonicalPr(workspaceDir, "test-project", 244, {
      number: 246,
      url: "https://example.com/pr/246",
      sourceBranch: "issue/244-canonical-pr-ledger-v2",
      repo: "owner/repo",
    }, PrState.OPEN);

    const refreshed = await refreshCanonicalPrStatus(workspaceDir, "test-project", 244, {
      state: PrState.APPROVED,
      url: "https://example.com/pr/246",
      number: 246,
      sourceBranch: "issue/244-canonical-pr-ledger-v2",
    });

    assert.equal(refreshed?.status, PrState.APPROVED);
    assert.equal(refreshed?.supersededPrs.length, 1);
    assert.equal(refreshed?.supersededPrs[0]?.url, "https://example.com/pr/245");
  });

  it("serializes concurrent updates so replacement and refresh do not lose data", async () => {
    const workspaceDir = await makeWorkspace();

    await recordCanonicalPr(workspaceDir, "test-project", 244, {
      number: 245,
      url: "https://example.com/pr/245",
      sourceBranch: "issue/244-a",
      repo: "owner/repo",
    }, PrState.OPEN);

    await Promise.all([
      refreshCanonicalPrStatus(workspaceDir, "test-project", 244, {
        state: PrState.CHANGES_REQUESTED,
        url: "https://example.com/pr/245",
        number: 245,
        sourceBranch: "issue/244-a",
      }),
      recordCanonicalPr(workspaceDir, "test-project", 244, {
        number: 246,
        url: "https://example.com/pr/246",
        sourceBranch: "issue/244-b",
        repo: "owner/repo",
      }, PrState.OPEN),
    ]);

    const record = await loadCanonicalPrRecord(workspaceDir, "test-project", 244);
    assert.ok(record);
    assert.equal(record?.url, "https://example.com/pr/246");
    assert.equal(record?.supersededPrs.length, 1);
    assert.equal(record?.supersededPrs[0]?.url, "https://example.com/pr/245");
  });

  it("fails closed when stored canonical PR is no longer linked to the issue", async () => {
    const workspaceDir = await makeWorkspace();
    const provider = new TestProvider();

    await recordCanonicalPr(workspaceDir, "test-project", 244, {
      number: 245,
      url: "https://example.com/pr/245",
      sourceBranch: "issue/244-a",
      repo: "owner/repo",
    }, PrState.OPEN);

    provider.setLinkedPrs(244, [{
      number: 246,
      url: "https://example.com/pr/246",
      sourceBranch: "issue/244-b",
      repo: "owner/repo",
    }]);
    provider.prStatuses.set(244, {
      state: PrState.OPEN,
      url: "https://example.com/pr/246",
      number: 246,
      sourceBranch: "issue/244-b",
    });

    await assert.rejects(
      resolveCanonicalPrForIssue({ workspaceDir, projectSlug: "test-project", issueId: 244, provider }),
      /stored PR .* is not in the issue's current linked PR set/,
    );
  });
});
