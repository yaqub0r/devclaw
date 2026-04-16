/**
 * context.ts — Lightweight DI container for the DevClaw plugin.
 *
 * Created once in register() and threaded to all tools, services, and hooks.
 * Replaces the global singleton in run-command.ts with explicit injection.
 */
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";

/**
 * RunCommand — the signature of api.runtime.system.runCommandWithTimeout.
 * Extracted so consumers don't need the full OpenClawPluginApi type.
 */
export type RunCommand = OpenClawPluginApi["runtime"]["system"]["runCommandWithTimeout"];

/**
 * PluginContext — shared services for all DevClaw modules.
 *
 * No framework, no decorators — just a plain object created once and
 * passed through factory functions and service registrations.
 */
export type PluginContext = {
  /** Run an external command via the plugin SDK (replaces global singleton). */
  runCommand: RunCommand;
  /** Plugin runtime for direct API access (channel messaging, gateway calls). */
  runtime: PluginRuntime;
  /** Plugin-level config from openclaw.json (notifications, heartbeat, etc.). */
  pluginConfig: Record<string, unknown> | undefined;
  /** Full OpenClaw config (agents list, defaults, etc.) — read-only. */
  config: OpenClawPluginApi["config"];
  /** Structured logger from the plugin SDK. */
  logger: OpenClawPluginApi["logger"];
};

/**
 * Build a PluginContext from the raw plugin API. Called once in register().
 */
export function createPluginContext(api: OpenClawPluginApi): PluginContext {
  const sdkRunCommand = api.runtime.system.runCommandWithTimeout;

  const runCommand: RunCommand = async (argv, optionsOrTimeout) => {
    const command = argv[0] ?? "";
    const isPinnedCli = command === "/usr/bin/gh" || command === "/usr/local/bin/gh" || command === "/usr/bin/glab" || command === "/usr/local/bin/glab";
    if (!isPinnedCli) {
      return sdkRunCommand(argv, optionsOrTimeout as any);
    }

    const options = typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : (optionsOrTimeout ?? {});
    const timeoutMs = options.timeoutMs ?? 30_000;
    const env = { ...process.env, ...(options.env ?? {}) } as Record<string, string>;

    return await new Promise<any>((resolve, reject) => {
      const child = spawn(command, argv.slice(1), {
        cwd: options.cwd,
        env,
        stdio: [options.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout?.on("data", (d) => { stdout += d.toString(); });
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code, signal, killed: timedOut, termination: timedOut ? "timeout" : "exit" });
      });

      if (options.input !== undefined && child.stdin) {
        child.stdin.write(options.input);
        child.stdin.end();
      }
    });
  };

  return {
    runCommand,
    runtime: api.runtime,
    pluginConfig: api.pluginConfig as Record<string, unknown> | undefined,
    config: api.config,
    logger: api.logger,
  };
}
