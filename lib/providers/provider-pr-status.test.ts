/**
 * Tests for getPrStatus() — distinguishing closed-PR from no-PR-exists.
 *
 * Issue #315: getPrStatus must return a non-null url for explicitly closed PRs
 * so callers can distinguish "PR was closed without merging" vs "no PR exists".
 *
 * Run with: npx tsx --test lib/providers/provider-pr-status.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type { RunCommand } from "../context.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";
import { PrState } from "./provider.js";

/** Noop runCommand for tests that mock all provider methods anyway. */
const mockRunCommand: RunCommand = async () => ({
  stdout: "", stderr: "", exitCode: 0, code: 0, signal: null, killed: false, termination: "exit",
} as any);

// ---------------------------------------------------------------------------
// GitHub provider tests
// ---------------------------------------------------------------------------

describe("GitHubProvider.getPrStatus — closed PR handling", () => {
  it("returns url:null when no PR has ever been created", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).findPrsForIssue = async () => [];
    (provider as any).findPrsViaTimeline = async () => null;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, null, "no PR exists → url must be null");
  });

  it("returns url:null when timeline returns empty array (no PRs at all)", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).findPrsForIssue = async () => [];
    (provider as any).findPrsViaTimeline = async () => [];

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, null, "empty timeline → url must be null");
  });

  it("returns url:closedPrUrl when a closed-without-merge PR exists", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const closedPrUrl = "https://github.com/owner/repo/pull/7";

    (provider as any).findPrsForIssue = async (_id: number, state: string) => {
      if (state === "open" || state === "merged") return [];
      return [];
    };
    (provider as any).findPrsViaTimeline = async (_id: number, state: string) => {
      if (state === "all") {
        return [
          {
            number: 7,
            title: "feat: some work",
            body: "",
            headRefName: "feature/7-some-work",
            url: closedPrUrl,
            mergedAt: null,
            reviewDecision: null,
            state: "CLOSED",
          },
        ];
      }
      return [];
    };

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, closedPrUrl, "closed PR → url must be the closed PR url");
    assert.strictEqual(status.sourceBranch, "feature/7-some-work");
  });

  it("prefers open PR over closed PR", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const openPrUrl = "https://github.com/owner/repo/pull/9";

    (provider as any).findPrsForIssue = async (_id: number, state: string) => {
      if (state === "open") {
        return [
          {
            title: "feat: open pr",
            body: "",
            headRefName: "feature/9-open-pr",
            url: openPrUrl,
            number: 9,
            reviewDecision: "",
            mergeable: "MERGEABLE",
          },
        ];
      }
      return [];
    };
    (provider as any).hasChangesRequestedReview = async () => false;
    (provider as any).hasUnacknowledgedReviews = async () => false;
    (provider as any).hasConversationComments = async () => false;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.OPEN);
    assert.strictEqual(status.url, openPrUrl);
  });

  it("prefers merged PR over closed PR", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const mergedPrUrl = "https://github.com/owner/repo/pull/5";

    (provider as any).findPrsForIssue = async (_id: number, state: string) => {
      if (state === "open") return [];
      if (state === "merged") {
        return [
          {
            title: "feat: merged",
            body: "",
            headRefName: "feature/5-merged",
            url: mergedPrUrl,
            reviewDecision: null,
          },
        ];
      }
      return [];
    };
    (provider as any).findPrsViaTimeline = async () => null;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.MERGED);
    assert.strictEqual(status.url, mergedPrUrl);
  });

  it("ignores non-CLOSED states in timeline when returning closed PR", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).findPrsForIssue = async () => [];
    (provider as any).findPrsViaTimeline = async (_id: number, state: string) => {
      if (state === "all") {
        return [{ number: 10, title: "", body: "", headRefName: "", url: "https://github.com/owner/repo/pull/10", mergedAt: null, reviewDecision: null, state: "OPEN", mergeable: null }];
      }
      return [];
    };

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, null, "OPEN state in timeline should not match closed-PR path");
  });

  it("detects merge conflicts via mergeable field", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const conflictedPrUrl = "https://github.com/owner/repo/pull/11";

    (provider as any).findPrsForIssue = async (_id: number, state: string) => {
      if (state === "open") {
        return [
          {
            title: "feat: conflicted pr",
            body: "",
            headRefName: "feature/11-conflicted",
            url: conflictedPrUrl,
            number: 11,
            reviewDecision: "",
            mergeable: "CONFLICTING",
          },
        ];
      }
      return [];
    };
    (provider as any).hasChangesRequestedReview = async () => false;
    (provider as any).hasUnacknowledgedReviews = async () => false;
    (provider as any).hasConversationComments = async () => false;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.OPEN);
    assert.strictEqual(status.url, conflictedPrUrl);
    assert.strictEqual(status.mergeable, false, "mergeable: CONFLICTING should be detected as false");
  });

  it("distinguishes mergeable states", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const mergeablePrUrl = "https://github.com/owner/repo/pull/12";

    (provider as any).findPrsForIssue = async (_id: number, state: string) => {
      if (state === "open") {
        return [
          {
            title: "feat: clean pr",
            body: "",
            headRefName: "feature/12-clean",
            url: mergeablePrUrl,
            number: 12,
            reviewDecision: "",
            mergeable: "MERGEABLE",
          },
        ];
      }
      return [];
    };
    (provider as any).hasChangesRequestedReview = async () => false;
    (provider as any).hasUnacknowledgedReviews = async () => false;
    (provider as any).hasConversationComments = async () => false;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.OPEN);
    assert.strictEqual(status.url, mergeablePrUrl);
    assert.strictEqual(status.mergeable, true, "mergeable: MERGEABLE should be detected as true");
  });

  it("handles unknown mergeable state", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const unknownPrUrl = "https://github.com/owner/repo/pull/13";

    (provider as any).findPrsForIssue = async (_id: number, state: string) => {
      if (state === "open") {
        return [
          {
            title: "feat: unknown state pr",
            body: "",
            headRefName: "feature/13-unknown",
            url: unknownPrUrl,
            number: 13,
            reviewDecision: "",
            mergeable: "UNKNOWN",
          },
        ];
      }
      return [];
    };
    (provider as any).hasChangesRequestedReview = async () => false;
    (provider as any).hasUnacknowledgedReviews = async () => false;
    (provider as any).hasConversationComments = async () => false;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.OPEN);
    assert.strictEqual(status.url, unknownPrUrl);
    assert.strictEqual(status.mergeable, undefined, "mergeable: UNKNOWN should remain undefined (no assumption)");
  });
});

describe("GitHubProvider.getPrStatusByUrl", () => {
  it("preserves comment-only feedback semantics for canonical PR routing", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).gh = async () => JSON.stringify({
      number: 44,
      title: "feat: canonical pr",
      headRefName: "issue/244-canonical-pr-ledger",
      url: "https://github.com/owner/repo/pull/44",
      state: "OPEN",
      reviewDecision: null,
      mergeable: "MERGEABLE",
    });
    (provider as any).hasChangesRequestedReview = async () => false;
    (provider as any).hasUnacknowledgedReviews = async () => true;
    (provider as any).hasConversationComments = async () => false;

    const status = await provider.getPrStatusByUrl("https://github.com/owner/repo/pull/44");

    assert.ok(status);
    assert.strictEqual(status.state, PrState.HAS_COMMENTS);
    assert.strictEqual(status.mergeable, true);
  });

  it("preserves changes-requested fallback when reviewDecision is empty", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).gh = async () => JSON.stringify({
      number: 45,
      title: "feat: canonical pr",
      headRefName: "issue/244-canonical-pr-ledger",
      url: "https://github.com/owner/repo/pull/45",
      state: "OPEN",
      reviewDecision: null,
      mergeable: "UNKNOWN",
    });
    (provider as any).hasChangesRequestedReview = async () => true;
    (provider as any).hasUnacknowledgedReviews = async () => false;
    (provider as any).hasConversationComments = async () => false;

    const status = await provider.getPrStatusByUrl("https://github.com/owner/repo/pull/45");

    assert.ok(status);
    assert.strictEqual(status.state, PrState.CHANGES_REQUESTED);
    assert.strictEqual(status.mergeable, undefined);
  });
});

describe("GitHubProvider canonical URL helpers", () => {
  it("throws when diff lookup fails after PR identity resolves", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });
    (provider as any).getPrByUrl = async () => ({
      number: 46,
      url: "https://github.com/owner/repo/pull/46",
      title: "feat: canonical pr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).gh = async () => {
      throw new Error("gh diff failed");
    };

    await assert.rejects(
      provider.getPrDiffByUrl("https://github.com/owner/repo/pull/46"),
      /gh diff failed/,
    );
  });

  it("throws when review comment retrieval fails after PR identity resolves", async () => {
    const provider = new GitHubProvider({ repoPath: "/fake", runCommand: mockRunCommand });
    (provider as any).getPrByUrl = async () => ({
      number: 47,
      url: "https://github.com/owner/repo/pull/47",
      title: "feat: canonical pr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).gh = async () => {
      throw new Error("gh reviews failed");
    };

    await assert.rejects(
      provider.getPrReviewCommentsByUrl("https://github.com/owner/repo/pull/47"),
      /gh reviews failed/,
    );
  });
});

// ---------------------------------------------------------------------------
// GitLab provider tests
// ---------------------------------------------------------------------------

describe("GitLabProvider.getPrStatus — closed MR handling", () => {
  it("returns url:null when no MR has ever been created", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).getRelatedMRs = async () => [];

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, null, "no MR exists → url must be null");
  });

  it("returns url:closedMrUrl when a closed-without-merge MR exists", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const closedMrUrl = "https://gitlab.com/owner/repo/-/merge_requests/3";

    (provider as any).getRelatedMRs = async () => [
      {
        iid: 3,
        title: "feat: some work",
        description: "",
        web_url: closedMrUrl,
        state: "closed",
        source_branch: "feature/3-some-work",
        merged_at: null,
      },
    ];

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, closedMrUrl, "closed MR → url must be the closed MR url");
    assert.strictEqual(status.sourceBranch, "feature/3-some-work");
  });

  it("prefers open MR over closed MR", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const openMrUrl = "https://gitlab.com/owner/repo/-/merge_requests/4";
    const closedMrUrl = "https://gitlab.com/owner/repo/-/merge_requests/2";

    (provider as any).getRelatedMRs = async () => [
      { iid: 4, title: "open MR", description: "", web_url: openMrUrl, state: "opened", source_branch: "feature/4", merged_at: null },
      { iid: 2, title: "closed MR", description: "", web_url: closedMrUrl, state: "closed", source_branch: "feature/2", merged_at: null },
    ];
    (provider as any).isMrApproved = async () => false;
    (provider as any).hasUnresolvedDiscussions = async () => false;
    (provider as any).hasConversationComments = async () => false;
    (provider as any).isMrMergeable = async () => true;

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.OPEN);
    assert.strictEqual(status.url, openMrUrl);
  });

  it("prefers merged MR over closed MR", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const mergedMrUrl = "https://gitlab.com/owner/repo/-/merge_requests/5";
    const closedMrUrl = "https://gitlab.com/owner/repo/-/merge_requests/1";

    (provider as any).getRelatedMRs = async () => [
      { iid: 5, title: "merged", description: "", web_url: mergedMrUrl, state: "merged", source_branch: "feature/5", merged_at: "2026-01-01T00:00:00Z" },
      { iid: 1, title: "closed", description: "", web_url: closedMrUrl, state: "closed", source_branch: "feature/1", merged_at: null },
    ];

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.MERGED);
    assert.strictEqual(status.url, mergedMrUrl);
  });

  it("handles multiple closed MRs — returns the first found", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    const closedMrUrl1 = "https://gitlab.com/owner/repo/-/merge_requests/10";
    const closedMrUrl2 = "https://gitlab.com/owner/repo/-/merge_requests/11";

    (provider as any).getRelatedMRs = async () => [
      { iid: 10, title: "closed 1", description: "", web_url: closedMrUrl1, state: "closed", source_branch: "feature/10", merged_at: null },
      { iid: 11, title: "closed 2", description: "", web_url: closedMrUrl2, state: "closed", source_branch: "feature/11", merged_at: null },
    ];

    const status = await provider.getPrStatus(42);

    assert.strictEqual(status.state, PrState.CLOSED);
    assert.strictEqual(status.url, closedMrUrl1);
  });
});

describe("GitLabProvider.getPrStatusByUrl", () => {
  it("preserves comment-driven feedback semantics for canonical MR routing", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).getPrByUrl = async () => ({
      number: 24,
      url: "https://gitlab.com/owner/repo/-/merge_requests/24",
      title: "feat: canonical mr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).glab = async () => JSON.stringify({
      state: "opened",
      title: "feat: canonical mr",
      source_branch: "issue/244-canonical-pr-ledger",
      web_url: "https://gitlab.com/owner/repo/-/merge_requests/24",
    });
    (provider as any).isMrApproved = async () => false;
    (provider as any).hasUnresolvedDiscussions = async () => false;
    (provider as any).hasConversationComments = async () => true;
    (provider as any).isMrMergeable = async () => true;

    const status = await provider.getPrStatusByUrl("https://gitlab.com/owner/repo/-/merge_requests/24");

    assert.ok(status);
    assert.strictEqual(status.state, PrState.HAS_COMMENTS);
    assert.strictEqual(status.mergeable, true);
  });

  it("preserves unresolved-discussion changes-requested semantics", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).getPrByUrl = async () => ({
      number: 25,
      url: "https://gitlab.com/owner/repo/-/merge_requests/25",
      title: "feat: canonical mr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).glab = async () => JSON.stringify({
      state: "opened",
      title: "feat: canonical mr",
      source_branch: "issue/244-canonical-pr-ledger",
      web_url: "https://gitlab.com/owner/repo/-/merge_requests/25",
    });
    (provider as any).isMrApproved = async () => false;
    (provider as any).hasUnresolvedDiscussions = async () => true;
    (provider as any).hasConversationComments = async () => false;
    (provider as any).isMrMergeable = async () => undefined;

    const status = await provider.getPrStatusByUrl("https://gitlab.com/owner/repo/-/merge_requests/25");

    assert.ok(status);
    assert.strictEqual(status.state, PrState.CHANGES_REQUESTED);
    assert.strictEqual(status.mergeable, undefined);
  });
});

describe("GitLabProvider.getPrReviewCommentsByUrl", () => {
  it("reuses canonical MR comment retrieval semantics", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).getPrByUrl = async () => ({
      number: 26,
      url: "https://gitlab.com/owner/repo/-/merge_requests/26",
      title: "feat: canonical mr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).glab = async ([, path]: string[]) => {
      if (path === "projects/:id/merge_requests/26/discussions") {
        return JSON.stringify([
          {
            notes: [
              {
                id: 101,
                author: { username: "reviewer" },
                body: "Please tighten this up",
                resolvable: true,
                resolved: false,
                system: false,
                created_at: "2026-05-31T00:00:00Z",
                position: { new_path: "lib/providers/gitlab.ts", new_line: 451 },
              },
            ],
          },
        ]);
      }
      if (path === "projects/:id/merge_requests/26/notes") {
        return JSON.stringify([
          {
            id: 102,
            author: { username: "reviewer" },
            system: false,
            body: "Top-level follow-up",
            created_at: "2026-05-31T00:01:00Z",
          },
        ]);
      }
      throw new Error(`unexpected glab path: ${path}`);
    };

    const comments = await provider.getPrReviewCommentsByUrl("https://gitlab.com/owner/repo/-/merge_requests/26");

    assert.deepStrictEqual(comments, [
      {
        id: 101,
        author: "reviewer",
        body: "Please tighten this up",
        state: "UNRESOLVED",
        created_at: "2026-05-31T00:00:00Z",
        path: "lib/providers/gitlab.ts",
        line: 451,
      },
      {
        id: 102,
        author: "reviewer",
        body: "Top-level follow-up",
        state: "COMMENTED",
        created_at: "2026-05-31T00:01:00Z",
      },
    ]);
  });

  it("throws when canonical MR comment retrieval fails after identity resolution", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).getPrByUrl = async () => ({
      number: 27,
      url: "https://gitlab.com/owner/repo/-/merge_requests/27",
      title: "feat: canonical mr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).glab = async () => {
      throw new Error("glab discussions failed");
    };

    await assert.rejects(
      provider.getPrReviewCommentsByUrl("https://gitlab.com/owner/repo/-/merge_requests/27"),
      /glab discussions failed/,
    );
  });
});

describe("GitLabProvider canonical URL helpers", () => {
  it("throws when diff lookup fails after MR identity resolves", async () => {
    const provider = new GitLabProvider({ repoPath: "/fake", runCommand: mockRunCommand });

    (provider as any).getPrByUrl = async () => ({
      number: 28,
      url: "https://gitlab.com/owner/repo/-/merge_requests/28",
      title: "feat: canonical mr",
      sourceBranch: "issue/244-canonical-pr-ledger",
    });
    (provider as any).glab = async () => {
      throw new Error("glab diff failed");
    };

    await assert.rejects(
      provider.getPrDiffByUrl("https://gitlab.com/owner/repo/-/merge_requests/28"),
      /glab diff failed/,
    );
  });
});
