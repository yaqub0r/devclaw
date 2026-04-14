/**
 * Tests for work_finish PR validation.
 *
 * Run with: npx tsx --test lib/tools/worker/work-finish.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePrExistsForDeveloper } from "./work-finish.js";
import { TestProvider } from "../../testing/test-provider.js";
import { GitHubProvider } from "../../providers/github.js";
import { PrState } from "../../providers/provider.js";

async function createMockAuditLog(workspaceDir: string, issueId: number, hasMergeConflict: boolean): Promise<void> {
  const logDir = join(workspaceDir, "devclaw", "log");
  await mkdir(logDir, { recursive: true });

  const auditPath = join(logDir, "audit.log");
  const entries = [
    JSON.stringify({ timestamp: "2026-03-01T10:00:00Z", event: "issue_created", issueId, project: "devclaw" }),
    ...(hasMergeConflict ? [JSON.stringify({
      timestamp: "2026-03-01T10:15:00Z",
      event: "review_transition",
      issueId,
      from: "In Review",
      to: "To Improve",
      reason: "merge_conflict",
      project: "devclaw",
    })] : []),
    JSON.stringify({ timestamp: "2026-03-01T10:30:00Z", event: "work_started", issueId, role: "developer", project: "devclaw" }),
  ];

  await writeFile(auditPath, `${entries.join("\n")}\n`);
}

describe("work_finish PR validation", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "work-finish-test-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("audit log parsing", () => {
    it("detects merge_conflict transitions", async () => {
      const issueId = 123;
      await createMockAuditLog(tempDir, issueId, true);
      const content = await readFile(join(tempDir, "devclaw", "log", "audit.log"), "utf-8");
      assert.ok(content.includes('"reason":"merge_conflict"'));
    });

    it("skips malformed JSON lines", async () => {
      const auditPath = join(tempDir, "devclaw", "log", "audit.log");
      await mkdir(join(tempDir, "devclaw", "log"), { recursive: true });
      await writeFile(auditPath, '{"event":"valid"}\n{ invalid json\n{"event":"valid_again"}\n');
      const content = await readFile(auditPath, "utf-8");
      const parsed = content.split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      assert.equal(parsed.length, 2);
    });
  });

  describe("validatePrExistsForDeveloper", () => {
    it("accepts a valid explicit PR URL for follow-up tasks", async () => {
      const provider = Object.create(GitHubProvider.prototype) as GitHubProvider & {
        prHasReaction: () => Promise<boolean>;
        reactToPr: (_issueId: number, _emoji: string) => Promise<void>;
        getPrStatus: (_issueId: number) => Promise<any>;
      };
      let reacted = false;
      provider.prHasReaction = async () => false;
      provider.reactToPr = async () => { reacted = true; };
      provider.getPrStatus = async () => ({ state: PrState.CLOSED, url: null });

      const runCommand = async (args: string[]) => {
        if (args[0] === "git") return { stdout: "feature/existing-pr\n", stderr: "", exitCode: 0 };
        if (args[0] === "gh" && args[1] === "pr" && args[2] === "view") {
          return {
            stdout: JSON.stringify({
              url: "https://github.com/test/repo/pull/105",
              title: "existing pr",
              state: "OPEN",
              headRefName: "feature/existing-pr",
              reviewDecision: null,
              mergeable: "MERGEABLE",
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      };

      await validatePrExistsForDeveloper(108, tempDir, provider, runCommand as any, tempDir, "devclaw", "https://github.com/test/repo/pull/105");
      assert.ok(reacted);
    });

    it("uses current branch PR lookup before issue-id lookup", async () => {
      const provider = Object.create(GitHubProvider.prototype) as GitHubProvider & {
        prHasReaction: () => Promise<boolean>;
        reactToPr: (_issueId: number, _emoji: string) => Promise<void>;
        getPrStatus: (_issueId: number) => Promise<any>;
      };
      let issueLookupCount = 0;
      provider.prHasReaction = async () => true;
      provider.reactToPr = async () => {};
      provider.getPrStatus = async () => {
        issueLookupCount++;
        return { state: PrState.CLOSED, url: null };
      };

      const runCommand = async (args: string[]) => {
        if (args[0] === "git") return { stdout: "feature/existing-pr\n", stderr: "", exitCode: 0 };
        if (args[0] === "gh" && args[1] === "pr" && args[2] === "list") {
          return {
            stdout: JSON.stringify([{
              url: "https://github.com/test/repo/pull/105",
              title: "existing pr",
              state: "OPEN",
              headRefName: "feature/existing-pr",
              reviewDecision: null,
              mergeable: "MERGEABLE",
            }]),
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      };

      await validatePrExistsForDeveloper(108, tempDir, provider, runCommand as any, tempDir, "devclaw");
      assert.equal(issueLookupCount, 0);
    });

    it("accepts a branch-matched PR that is already merged externally", async () => {
      const provider = Object.create(GitHubProvider.prototype) as GitHubProvider & {
        prHasReaction: () => Promise<boolean>;
        reactToPr: (_issueId: number, _emoji: string) => Promise<void>;
        getPrStatus: (_issueId: number) => Promise<any>;
      };
      let issueLookupCount = 0;
      provider.prHasReaction = async () => true;
      provider.reactToPr = async () => {};
      provider.getPrStatus = async () => {
        issueLookupCount++;
        return { state: PrState.CLOSED, url: null };
      };

      const runCommand = async (args: string[]) => {
        if (args[0] === "git") return { stdout: "feature/existing-pr\n", stderr: "", exitCode: 0 };
        if (args[0] === "gh" && args[1] === "pr" && args[2] === "list") {
          return {
            stdout: JSON.stringify([{
              url: "https://github.com/test/repo/pull/105",
              title: "existing pr",
              state: "MERGED",
              headRefName: "feature/existing-pr",
              reviewDecision: "APPROVED",
              mergeable: null,
            }]),
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      };

      await validatePrExistsForDeveloper(108, tempDir, provider, runCommand as any, tempDir, "devclaw");
      assert.equal(issueLookupCount, 0, 'merged branch lookup should still be canonical without falling back to issue scan');
    });

    it("validates explicit URLs for non-GitHub providers against the linked PR", async () => {
      const provider = new TestProvider();
      provider.setPrStatus(42, {
        state: PrState.OPEN,
        url: "https://gitlab.example.com/group/project/-/merge_requests/9",
        sourceBranch: "feature/existing-mr",
        mergeable: true,
      });

      const runCommand = async () => ({ stdout: "feature/existing-mr\n", stderr: "", exitCode: 0 });
      await validatePrExistsForDeveloper(
        42,
        tempDir,
        provider as any,
        runCommand as any,
        tempDir,
        "devclaw",
        "https://gitlab.example.com/group/project/-/merge_requests/9",
      );
      assert.equal(provider.callsTo("getPrStatus").length, 1);
    });

    it("rejects invalid explicit URLs for non-GitHub providers", async () => {
      const provider = new TestProvider();
      provider.setPrStatus(42, {
        state: PrState.OPEN,
        url: "https://gitlab.example.com/group/project/-/merge_requests/9",
        sourceBranch: "feature/existing-mr",
        mergeable: true,
      });

      const runCommand = async () => ({ stdout: "feature/existing-mr\n", stderr: "", exitCode: 0 });
      await assert.rejects(
        () => validatePrExistsForDeveloper(
          42,
          tempDir,
          provider as any,
          runCommand as any,
          tempDir,
          "devclaw",
          "https://gitlab.example.com/group/project/-/merge_requests/999",
        ),
        /Cannot mark work_finish\(done\) without an open PR/,
      );
      assert.equal(provider.callsTo("getPrStatus").length, 1);
    });

    it("keeps normal issue-to-PR flows working", async () => {
      const provider = new TestProvider();
      provider.setPrStatus(42, {
        state: PrState.OPEN,
        url: "https://github.com/test/repo/pull/42",
        sourceBranch: "feature/42-normal-flow",
        mergeable: true,
      });

      const runCommand = async () => ({ stdout: "feature/42-normal-flow\n", stderr: "", exitCode: 0 });
      await validatePrExistsForDeveloper(42, tempDir, provider as any, runCommand as any, tempDir, "devclaw");
      assert.equal(provider.callsTo("getPrStatus").length, 1);
    });

    it("accepts a merged canonical PR even when the local branch no longer has a matching remote PR", async () => {
      const provider = Object.create(GitHubProvider.prototype) as GitHubProvider & {
        prHasReaction: () => Promise<boolean>;
        reactToPr: (_issueId: number, _emoji: string) => Promise<void>;
        getPrStatus: (_issueId: number) => Promise<any>;
      };
      let issueLookupCount = 0;
      provider.prHasReaction = async () => true;
      provider.reactToPr = async () => {};
      provider.getPrStatus = async () => {
        issueLookupCount++;
        return {
          state: PrState.MERGED,
          url: "https://github.com/test/repo/pull/200",
          title: "merged already",
          sourceBranch: "feature/61-cleanup",
        };
      };

      const runCommand = async (args: string[]) => {
        if (args[0] === "git") return { stdout: "feature/61-cleanup\n", stderr: "", exitCode: 0 };
        if (args[0] === "gh" && args[1] === "pr" && args[2] === "list") {
          return { stdout: "[]", stderr: "", exitCode: 0 };
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      };

      await validatePrExistsForDeveloper(61, tempDir, provider, runCommand as any, tempDir, "devclaw");
      assert.equal(issueLookupCount, 1);
    });

    it("rejects follow-up completion when the reused PR is still conflicting", async () => {
      await createMockAuditLog(tempDir, 108, true);

      const provider = Object.create(GitHubProvider.prototype) as GitHubProvider & {
        prHasReaction: () => Promise<boolean>;
        reactToPr: (_issueId: number, _emoji: string) => Promise<void>;
        getPrStatus: (_issueId: number) => Promise<any>;
      };
      provider.prHasReaction = async () => true;
      provider.reactToPr = async () => {};
      provider.getPrStatus = async () => ({ state: PrState.CLOSED, url: null });

      const runCommand = async (args: string[]) => {
        if (args[0] === "git") return { stdout: "feature/existing-pr\n", stderr: "", exitCode: 0 };
        if (args[0] === "gh" && args[1] === "pr" && args[2] === "view") {
          return {
            stdout: JSON.stringify({
              url: "https://github.com/test/repo/pull/105",
              title: "existing pr",
              state: "OPEN",
              headRefName: "feature/existing-pr",
              reviewDecision: null,
              mergeable: "CONFLICTING",
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      };

      await assert.rejects(
        () => validatePrExistsForDeveloper(108, tempDir, provider, runCommand as any, tempDir, "devclaw", "https://github.com/test/repo/pull/105"),
        /still shows merge conflicts/,
      );
    });
  });
});
