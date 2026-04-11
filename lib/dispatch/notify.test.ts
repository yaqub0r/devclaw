/**
 * Tests for notification delivery fallbacks.
 *
 * Run with: npx tsx --test lib/dispatch/notify.test.ts
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommandOptions, SpawnResult } from "openclaw/plugin-sdk/process/exec";
import { notify } from "./notify.js";

describe("notify", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devclaw-notify-test-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("falls back to CLI when the Telegram runtime sender is unavailable", async () => {
    const calls: Array<{ args: string[]; timeoutMs?: number }> = [];

    const ok = await notify(
      {
        type: "workerStart",
        project: "devclaw",
        issueId: 7,
        issueTitle: "Fix Telegram worker notifications",
        issueUrl: "https://example.com/issues/7",
        role: "developer",
        level: "senior",
        name: "firstlight",
        sessionAction: "spawn",
      },
      {
        workspaceDir: tempDir,
        channelId: "-100123",
        channel: "telegram",
        runtime: { channel: {} } as any,
        runCommand: async (args, opts): Promise<SpawnResult> => {
          const options = typeof opts === "number" ? { timeoutMs: opts } : opts as CommandOptions;
          calls.push({ args, timeoutMs: options?.timeoutMs });
          return {
            stdout: "",
            stderr: "",
            code: 0,
            signal: null,
            killed: false,
            termination: "exit",
          };
        },
      },
    );

    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args.slice(0, 6), [
      "openclaw",
      "message",
      "send",
      "--channel",
      "telegram",
      "--target",
    ]);
    assert.equal(calls[0]?.args[6], "-100123");
    assert.equal(calls[0]?.timeoutMs, 30_000);
  });

  it("falls back to CLI when the runtime sender throws", async () => {
    const calls: Array<{ args: string[]; timeoutMs?: number }> = [];

    const ok = await notify(
      {
        type: "workerComplete",
        project: "devclaw",
        issueId: 7,
        issueUrl: "https://example.com/issues/7",
        role: "developer",
        result: "done",
      },
      {
        workspaceDir: tempDir,
        channelId: "-100123",
        channel: "telegram",
        runtime: {
          channel: {
            telegram: {
              sendMessageTelegram: async () => {
                throw new Error("telegram runtime unavailable");
              },
            },
          },
        } as any,
        runCommand: async (args, opts): Promise<SpawnResult> => {
          const options = typeof opts === "number" ? { timeoutMs: opts } : opts as CommandOptions;
          calls.push({ args, timeoutMs: options?.timeoutMs });
          return {
            stdout: "",
            stderr: "",
            code: 0,
            signal: null,
            killed: false,
            termination: "exit",
          };
        },
      },
    );

    assert.equal(ok, true);
    assert.equal(calls.length, 1);

    const auditLog = await readFile(join(tempDir, "devclaw", "log", "audit.log"), "utf-8");
    assert.match(auditLog, /"event":"notify_runtime_error"/);
    assert.match(auditLog, /telegram runtime unavailable/);
    assert.match(auditLog, /"event":"notify_delivery"/);
    assert.match(auditLog, /"delivery":"cli-fallback"/);
  });

  it("logs notify_error and returns false when no sender is available", async () => {
    const ok = await notify(
      {
        type: "workerComplete",
        project: "devclaw",
        issueId: 7,
        issueUrl: "https://example.com/issues/7",
        role: "developer",
        result: "done",
      },
      {
        workspaceDir: tempDir,
        channelId: "-100123",
        channel: "telegram",
        runtime: { channel: {} } as any,
      },
    );

    assert.equal(ok, false);

    const auditLog = await readFile(join(tempDir, "devclaw", "log", "audit.log"), "utf-8");
    assert.match(auditLog, /"event":"notify_error"/);
    assert.match(auditLog, /"delivery":"failed"/);
    assert.match(auditLog, /No runtime sender available for channel telegram/);
  });
});
