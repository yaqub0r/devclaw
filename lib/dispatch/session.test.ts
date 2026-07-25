import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunCommand } from "../context.js";
import { sendToAgent } from "./session.js";

describe("gateway agent dispatch compatibility", () => {
  it("omits unsupported spawnedBy while preserving supported routing fields", () => {
    const calls: Array<{ argv: string[]; timeoutMs?: number }> = [];
    const runCommand = (async (
      argv: string[],
      options?: number | { timeoutMs?: number },
    ) => {
      calls.push({
        argv,
        timeoutMs: typeof options === "number" ? options : options?.timeoutMs,
      });
      return {
        stdout: "{}",
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
        termination: "exit",
      };
    }) as unknown as RunCommand;

    const sessionKey =
      "agent:devclaw:subagent:firstlight-architect-junior-judi";
    sendToAgent(sessionKey, "Research issue #902", {
      agentId: "devclaw",
      projectName: "Firstlight",
      issueId: 902,
      role: "architect",
      level: "junior",
      slotIndex: 0,
      fromLabel: "To Research",
      workspaceDir: "C:/devclaw-test",
      dispatchTimeoutMs: 45_000,
      extraSystemPrompt: "Architect instructions",
      runCommand,
      notifyTarget: {
        channelId: "-100123",
        channel: "telegram",
        accountId: "default",
        messageThreadId: 42,
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.timeoutMs, 45_000);
    assert.deepEqual(calls[0]?.argv.slice(0, 5), [
      "openclaw",
      "gateway",
      "call",
      "agent",
      "--params",
    ]);
    assert.deepEqual(calls[0]?.argv.slice(6), ["--expect-final", "--json"]);

    const params = JSON.parse(calls[0]?.argv[5] ?? "{}");
    assert.deepEqual(params, {
      idempotencyKey:
        `devclaw-Firstlight-902-architect-junior-0-To Research-${sessionKey}`,
      agentId: "devclaw",
      sessionKey,
      message: "Research issue #902",
      deliver: false,
      lane: "subagent",
      extraSystemPrompt: "Architect instructions",
      to: "-100123",
      channel: "telegram",
      accountId: "default",
      threadId: "42",
    });
    assert.equal("spawnedBy" in params, false);
  });
});
