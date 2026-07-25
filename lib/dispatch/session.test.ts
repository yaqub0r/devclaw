import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { RunCommand } from "../context.js";
import { assertConfiguredModelAvailable } from "./model-availability.js";
import { buildMainOrchestratorSessionKey, sendToAgent } from "./session.js";

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
      "agent:devclaw:subagent:example-project-architect-junior-worker-a";
    await sendToAgent(sessionKey, "Research issue #101", {
      agentId: "devclaw",
      projectName: "Example Project",
      issueId: 101,
      role: "architect",
      level: "junior",
      slotIndex: 0,
      fromLabel: "To Research",
      workspaceDir: "C:/devclaw-test",
      dispatchTimeoutMs: 45_000,
      extraSystemPrompt: "Architect instructions",
      runCommand,
      notifyTarget: {
        channelId: "-1000000000000",
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
        `devclaw-Example Project-101-architect-junior-0-To Research-${sessionKey}`,
      agentId: "devclaw",
      sessionKey,
      message: "Research issue #101",
      deliver: false,
      lane: "subagent",
      extraSystemPrompt: "Architect instructions",
      to: "-1000000000000",
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
          return { runId: "run-example-project-101" };
        },
      },
    } as unknown as PluginRuntime;
    const runCommand = (async () => {
      throw new Error("legacy gateway CLI should not be called");
    }) as unknown as RunCommand;
    const sessionKey =
      "agent:devclaw:subagent:example-project-architect-junior-worker-a";

    const acceptance = await sendToAgent(sessionKey, "Research issue #101", {
      agentId: "devclaw",
      projectName: "Example Project",
      issueId: 101,
      role: "architect",
      level: "junior",
      slotIndex: 0,
      fromLabel: "To Research",
      workspaceDir: "C:/devclaw-test",
      model: "openai/gpt-5.5",
      sessionLabel: "Example Project architect junior Worker A",
      sessionPatchTimeoutMs: 30_000,
      extraSystemPrompt: "Architect instructions",
      runCommand,
      runtime,
      parentSessionKey: "agent:devclaw:telegram:group:-1000000000000:topic:42",
    });

    assert.deepEqual(acceptance, {
      transport: "plugin-runtime",
      runId: "run-example-project-101",
    });
    assert.deepEqual(gatewayCalls, [{
      method: "sessions.patch",
      params: {
        key: sessionKey,
        model: "openai/gpt-5.5",
        label: "Example Project architect junior Worker A",
        spawnedBy: "agent:devclaw:telegram:group:-1000000000000:topic:42",
      },
      options: { timeoutMs: 30_000 },
    }]);
    assert.deepEqual(subagentCalls, [{
      sessionKey,
      message: "Research issue #101",
      extraSystemPrompt: "Architect instructions",
      lane: "subagent",
      deliver: false,
      idempotencyKey:
        `devclaw-Example Project-101-architect-junior-0-To Research-${sessionKey}`,
    }]);
    assert.equal("spawnedBy" in subagentCalls[0]!, false);
  });

  it("derives stable main orchestrator keys for chat and topic lineage", () => {
    assert.equal(
      buildMainOrchestratorSessionKey("devclaw", {
        channel: "telegram",
        channelId: "-1000000000000",
      }),
      "agent:devclaw:telegram:group:-1000000000000",
    );
    assert.equal(
      buildMainOrchestratorSessionKey("devclaw", {
        channel: "telegram",
        channelId: "-1000000000000",
        messageThreadId: 42,
      }),
      "agent:devclaw:telegram:group:-1000000000000:topic:42",
    );
  });

  it("accepts a model present in the configured gateway catalog", async () => {
    const calls: string[] = [];
    const runtime = {
      gateway: {
        async request(method: string) {
          calls.push(method);
          return {
            models: [
              { provider: "openai", id: "gpt-5.5" },
              { provider: "google", id: "gemini-3-pro" },
            ],
          };
        },
      },
      subagent: {
        async run() {
          return { runId: "unused" };
        },
      },
    } as unknown as PluginRuntime;

    await assertConfiguredModelAvailable("openai/gpt-5.5", {
      runtime,
      projectName: "Example Project",
      role: "architect",
      level: "junior",
    });
    assert.deepEqual(calls, ["models.list"]);
  });

  it("rejects a definitively unavailable model with project context", async () => {
    const runtime = {
      gateway: {
        async request() {
          return {
            models: [{ provider: "google", id: "gemini-3-pro" }],
          };
        },
      },
      subagent: {
        async run() {
          return { runId: "unused" };
        },
      },
    } as unknown as PluginRuntime;

    await assert.rejects(
      assertConfiguredModelAvailable("anthropic/claude-sonnet-4-5", {
        runtime,
        projectName: "Example Project",
        role: "architect",
        level: "junior",
      }),
      /Configured model unavailable for Example Project architect\/junior: anthropic\/claude-sonnet-4-5/,
    );
  });

  it("fails open when an older gateway does not expose a readable catalog", async () => {
    const runtime = {
      gateway: {
        async request() {
          throw new Error("unknown method: models.list");
        },
      },
      subagent: {
        async run() {
          return { runId: "unused" };
        },
      },
    } as unknown as PluginRuntime;

    await assert.doesNotReject(
      assertConfiguredModelAvailable("custom/private-model", {
        runtime,
        projectName: "Legacy",
        role: "developer",
        level: "medior",
      }),
    );
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
      sendToAgent("agent:devclaw:subagent:example-project-architect-junior-worker-a", "Task", {
        projectName: "Example Project",
        issueId: 101,
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
