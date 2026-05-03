/**
 * Test harness — scaffolds a temporary workspace with projects.json,
 * installs a mock runCommand, and provides helpers for E2E pipeline tests.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeProjects, type ProjectsData, type Project, type RoleWorkerState } from "../projects/index.js";
import { DEFAULT_WORKFLOW, type WorkflowConfig } from "../workflow/index.js";
import { registerBootstrapHook } from "../dispatch/bootstrap-hook.js";
import { TestProvider } from "./test-provider.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginContext } from "../context.js";

export type BootstrapFile = {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
};

export type BootstrapResult = {
  agentsMdStripped: boolean;
  bootstrapFileNames: string[];
  orchestratorContent?: string;
  agentsContent?: string;
  bootstrapFiles: BootstrapFile[];
};

export type CapturedCommand = {
  argv: string[];
  opts: { timeoutMs: number; cwd?: string };
  taskMessage?: string;
  extraSystemPrompt?: string;
  agentModel?: string;
  sessionPatch?: { key: string; model: string; label?: string };
};

export type CommandInterceptor = {
  commands: CapturedCommand[];
  commandsFor(cmd: string): CapturedCommand[];
  taskMessages(): string[];
  extraSystemPrompts(): string[];
  agentModels(): string[];
  sessionPatches(): Array<{ key: string; model: string; label?: string }>;
  reset(): void;
};

function createCommandInterceptor(): {
  interceptor: CommandInterceptor;
  handler: (argv: string[], opts: number | { timeoutMs: number; cwd?: string }) => Promise<{ stdout: string; stderr: string; code: number | null; signal: null; killed: false }>;
} {
  const commands: CapturedCommand[] = [];

  const handler = async (
    argv: string[],
    optsOrTimeout: number | { timeoutMs: number; cwd?: string },
  ) => {
    const opts = typeof optsOrTimeout === "number"
      ? { timeoutMs: optsOrTimeout }
      : optsOrTimeout;

    const captured: CapturedCommand = { argv, opts };

    if (argv[0] === "openclaw" && argv[1] === "gateway" && argv[2] === "call") {
      const rpcMethod = argv[3];
      const paramsIdx = argv.indexOf("--params");
      if (paramsIdx !== -1 && argv[paramsIdx + 1]) {
        try {
          const params = JSON.parse(argv[paramsIdx + 1]);
          if (rpcMethod === "agent" && params.message) {
            captured.taskMessage = params.message;
            if (params.extraSystemPrompt) captured.extraSystemPrompt = params.extraSystemPrompt;
            if (params.model) captured.agentModel = params.model;
          }
          if (rpcMethod === "sessions.patch") {
            captured.sessionPatch = { key: params.key, model: params.model, label: params.label };
          }
        } catch {}
      }
    }

    commands.push(captured);
    return { stdout: "{}", stderr: "", code: 0, signal: null as null, killed: false as const };
  };

  const interceptor: CommandInterceptor = {
    commands,
    commandsFor(cmd: string) {
      return commands.filter((c) => c.argv[0] === cmd);
    },
    taskMessages() {
      return commands.filter((c) => c.taskMessage !== undefined).map((c) => c.taskMessage!);
    },
    extraSystemPrompts() {
      return commands.filter((c) => c.extraSystemPrompt !== undefined).map((c) => c.extraSystemPrompt!);
    },
    agentModels() {
      return commands.filter((c) => c.agentModel !== undefined).map((c) => c.agentModel!);
    },
    sessionPatches() {
      return commands.filter((c) => c.sessionPatch !== undefined).map((c) => c.sessionPatch!);
    },
    reset() {
      commands.length = 0;
    },
  };

  return { interceptor, handler };
}

export type TestHarness = {
  workspaceDir: string;
  provider: TestProvider;
  commands: CommandInterceptor;
  runCommand: import("../context.js").RunCommand;
  channelId: string;
  project: Project;
  workflow: WorkflowConfig;
  writeProjects(data: ProjectsData): Promise<void>;
  readProjects(): Promise<ProjectsData>;
  writePrompt(role: string, content: string, projectName?: string): Promise<void>;
  simulateBootstrap(sessionKey: string, contextOverrides?: Record<string, unknown>): Promise<BootstrapResult>;
  cleanup(): Promise<void>;
};

export type HarnessOptions = {
  projectName?: string;
  channelId?: string;
  messageThreadId?: number;
  repo?: string;
  baseBranch?: string;
  workflow?: WorkflowConfig;
  workers?: Record<string, { level?: string; active?: boolean; issueId?: string | null; sessionKey?: string | null; startTime?: string | null; previousLabel?: string | null }>;
  extraProjects?: Record<string, Project>;
};

export async function createTestHarness(opts?: HarnessOptions): Promise<TestHarness> {
  const {
    projectName = "test-project",
    channelId = "-1234567890",
    messageThreadId,
    repo = "/tmp/test-repo",
    baseBranch = "main",
    workflow = DEFAULT_WORKFLOW,
    workers: workerOverrides,
    extraProjects,
  } = opts ?? {};

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-e2e-"));
  const dataDir = path.join(workspaceDir, "devclaw");
  const logDir = path.join(dataDir, "log");
  await fs.mkdir(logDir, { recursive: true });

  const emptyRW = (): RoleWorkerState => ({ levels: {} });
  const defaultWorkers: Record<string, RoleWorkerState> = {
    developer: emptyRW(),
    tester: emptyRW(),
    architect: emptyRW(),
    reviewer: emptyRW(),
  };

  if (workerOverrides) {
    for (const [role, overrides] of Object.entries(workerOverrides)) {
      const level = overrides.level ?? "senior";
      const rw = defaultWorkers[role] ?? emptyRW();
      rw.levels[level] = [{
        active: overrides.active ?? false,
        issueId: overrides.issueId ?? null,
        sessionKey: overrides.sessionKey ?? null,
        startTime: overrides.startTime ?? null,
        previousLabel: overrides.previousLabel ?? null,
      }];
      defaultWorkers[role] = rw;
    }
  }

  const project: Project = {
    slug: projectName,
    name: projectName,
    repo,
    groupName: "Test Group",
    deployUrl: "",
    baseBranch,
    deployBranch: baseBranch,
    channels: [{
      channelId,
      channel: "telegram",
      name: "primary",
      events: ["*"],
      ...(messageThreadId != null ? { messageThreadId } : {}),
    }],
    provider: "github",
    workers: defaultWorkers,
  };

  const projectsData: ProjectsData = {
    projects: {
      [projectName]: project,
      ...extraProjects,
    },
  };

  await writeProjects(workspaceDir, projectsData);
  const { interceptor, handler } = createCommandInterceptor();
  const provider = new TestProvider({ workflow });

  return {
    workspaceDir,
    provider,
    commands: interceptor,
    runCommand: handler as unknown as import("../context.js").RunCommand,
    channelId,
    project,
    workflow,
    async writeProjects(data: ProjectsData) {
      await writeProjects(workspaceDir, data);
    },
    async readProjects() {
      const { readProjects } = await import("../projects/index.js");
      return readProjects(workspaceDir);
    },
    async writePrompt(role: string, content: string, forProject?: string) {
      const dir = forProject
        ? path.join(dataDir, "projects", forProject, "prompts")
        : path.join(dataDir, "prompts");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${role}.md`), content, "utf-8");
    },
    async simulateBootstrap(
      sessionKey: string,
      contextOverrides: Record<string, unknown> = {},
    ) {
      let internalHookCb: ((event: any) => Promise<void>) | null = null;
      const mockApi = {
        registerHook(_name: string, cb: (event: any) => Promise<void>) {
          internalHookCb = cb;
        },
        logger: {
          debug() {},
          info() {},
          warn() {},
          error() {},
        },
      } as unknown as OpenClawPluginApi;

      const mockCtx = { logger: mockApi.logger } as unknown as PluginContext;
      registerBootstrapHook(mockApi, mockCtx);

      const bootstrapFiles = (contextOverrides.bootstrapFiles as BootstrapFile[] | undefined) ?? [
        {
          name: "AGENTS.md",
          path: path.join(workspaceDir, "AGENTS.md"),
          content: "# Orchestrator instructions\nThis content should be stripped.",
          missing: false,
        },
      ];

      const hookCb = internalHookCb as ((event: any) => Promise<void>) | null;
      if (hookCb) {
        await hookCb({
          sessionKey,
          context: { workspaceDir, bootstrapFiles, ...contextOverrides },
        });
      }

      const orchestratorEntry = bootstrapFiles.find((f) => f.name === "orchestrator.md");
      return {
        agentsMdStripped: bootstrapFiles[0].missing === true && bootstrapFiles[0].content === "",
        bootstrapFileNames: bootstrapFiles.map((f) => f.name),
        orchestratorContent: orchestratorEntry?.content,
        agentsContent: bootstrapFiles[0]?.content,
        bootstrapFiles,
      };
    },
    async cleanup() {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    },
  };
}
