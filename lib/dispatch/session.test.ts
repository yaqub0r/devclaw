import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { RunCommand } from "../context.js";
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
    const subagentCalls: Array<Record<string, unknown>> = [];
    const sessionPatches: Array<Record<string, unknown>> = [];
    const runtime = {
      gateway: {
        async request() {
          throw new Error("gateway.request must not be called by an untrusted plugin");
        },
      },
      agent: {
        session: {
          async patchSessionEntry(params: {
            update: (entry: Record<string, unknown>) => Record<string, unknown>;
          } & Record<string, unknown>) {
            sessionPatches.push({
              ...params,
              update: params.update({}),
            });
            return {};
          },
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
    assert.deepEqual(subagentCalls, [{
      sessionKey,
      message: "Research issue #101",
      provider: "openai",
      model: "gpt-5.5",
      extraSystemPrompt: "Architect instructions",
      lane: "subagent",
      deliver: false,
      idempotencyKey:
        `devclaw-Example Project-101-architect-junior-0-To Research-${sessionKey}`,
    }]);
    assert.deepEqual(sessionPatches, [{
      agentId: "devclaw",
      sessionKey,
      preserveActivity: true,
      update: {
        label: "Example Project architect junior Worker A",
        spawnedBy: "agent:devclaw:telegram:group:-1000000000000:topic:42",
      },
    }]);
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

  it("surfaces model override policy rejection from the native launch", async () => {
    let gatewayCalled = false;
    const runtime = {
      gateway: {
        async request() {
          gatewayCalled = true;
          throw new Error("gateway.request must not be called");
        },
      },
      subagent: {
        async run(params: Record<string, unknown>) {
          assert.equal(params.provider, "anthropic");
          assert.equal(params.model, "claude-sonnet-4-5");
          throw new Error(
            'model override "anthropic/claude-sonnet-4-5" is not allowlisted for plugin "devclaw".',
          );
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
      /is not allowlisted for plugin "devclaw"/,
    );
    assert.equal(gatewayCalled, false);
  });

  it("keeps an accepted run accepted when the optional metadata patch fails", async () => {
    const runtime = {
      agent: {
        session: {
          async patchSessionEntry() {
            throw new Error("metadata store unavailable");
          },
        },
      },
      subagent: {
        async run() {
          return { runId: "run-accepted" };
        },
      },
    } as unknown as PluginRuntime;

    await assert.doesNotReject(
      sendToAgent("agent:devclaw:subagent:example-project-developer-medior-worker-a", "Task", {
        agentId: "devclaw",
        projectName: "Example Project",
        issueId: 102,
        role: "developer",
        level: "medior",
        workspaceDir: "C:/devclaw-test",
        model: "openai/gpt-5.5",
        sessionLabel: "Example Project developer medior Worker A",
        parentSessionKey: "agent:devclaw:telegram:group:-1000000000000",
        runCommand: (async () => {
          throw new Error("legacy gateway CLI should not be called");
        }) as unknown as RunCommand,
        runtime,
      }),
    );
  });
});
