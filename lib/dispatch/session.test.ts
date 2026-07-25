import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { RunCommand } from "../context.js";
import { sendToAgent } from "./session.js";

describe("gateway agent dispatch compatibility", () => {
  it("omits unsupported spawnedBy from the legacy gateway payload", async () => {
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
    await sendToAgent(sessionKey, "Research issue #902", {
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

  it("uses the 2026.7 plugin runtime and returns accepted run identity", async () => {
    const gatewayCalls: Array<{
      method: string;
      params?: Record<string, unknown>;
      options?: { timeoutMs?: number };
    }> = [];
    const subagentCalls: Array<Record<string, unknown>> = [];
    const runtime = {
      gateway: {
        async request(
          method: string,
          params?: Record<string, unknown>,
          options?: { timeoutMs?: number },
        ) {
          gatewayCalls.push({ method, params, options });
          return {};
        },
      },
      subagent: {
        async run(params: Record<string, unknown>) {
          subagentCalls.push(params);
          return { runId: "run-firstlight-902" };
        },
      },
    } as unknown as PluginRuntime;
    const runCommand = (async () => {
      throw new Error("legacy gateway CLI should not be called");
    }) as unknown as RunCommand;
    const sessionKey =
      "agent:devclaw:subagent:firstlight-architect-junior-judi";

    const acceptance = await sendToAgent(sessionKey, "Research issue #902", {
      agentId: "devclaw",
      projectName: "Firstlight",
      issueId: 902,
      role: "architect",
      level: "junior",
      slotIndex: 0,
      fromLabel: "To Research",
      workspaceDir: "C:/devclaw-test",
      model: "openai/gpt-5.5",
      sessionLabel: "Firstlight architect junior Judi",
      sessionPatchTimeoutMs: 30_000,
      extraSystemPrompt: "Architect instructions",
      runCommand,
      runtime,
    });

    assert.deepEqual(acceptance, {
      transport: "plugin-runtime",
      runId: "run-firstlight-902",
    });
    assert.deepEqual(gatewayCalls, [{
      method: "sessions.patch",
      params: {
        key: sessionKey,
        model: "openai/gpt-5.5",
        label: "Firstlight architect junior Judi",
      },
      options: { timeoutMs: 30_000 },
    }]);
    assert.deepEqual(subagentCalls, [{
      sessionKey,
      message: "Research issue #902",
      extraSystemPrompt: "Architect instructions",
      lane: "subagent",
      deliver: false,
      idempotencyKey:
        `devclaw-Firstlight-902-architect-junior-0-To Research-${sessionKey}`,
    }]);
    assert.equal("spawnedBy" in subagentCalls[0]!, false);
  });

  it("does not launch a worker when session provisioning is rejected", async () => {
    let runCalled = false;
    const runtime = {
      gateway: {
        async request() {
          throw new Error("model is not allowed");
        },
      },
      subagent: {
        async run() {
          runCalled = true;
          return { runId: "unexpected" };
        },
      },
    } as unknown as PluginRuntime;

    await assert.rejects(
      sendToAgent("agent:devclaw:subagent:firstlight-architect-junior-judi", "Task", {
        projectName: "Firstlight",
        issueId: 902,
        role: "architect",
        level: "junior",
        workspaceDir: "C:/devclaw-test",
        model: "anthropic/claude-sonnet-4-5",
        runCommand: (async () => {
          throw new Error("legacy gateway CLI should not be called");
        }) as unknown as RunCommand,
        runtime,
      }),
      /model is not allowed/,
    );
    assert.equal(runCalled, false);
  });
});
