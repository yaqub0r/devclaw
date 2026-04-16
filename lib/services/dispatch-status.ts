/**
 * dispatch-status.ts — durable per-issue worker delivery and output observability.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

export type DispatchStatus = {
  projectSlug: string;
  projectName?: string;
  issueId: number;
  role: string;
  level: string;
  sessionKey: string;
  sessionAction: "spawn" | "send";
  labelMovedAt: string;
  workerName?: string;
  progressCommentId?: number;
  failureCommentId?: number;
  sessionPatchStartedAt?: string;
  sessionPatchSucceededAt?: string;
  sessionPatchFailedAt?: string;
  sessionPatchError?: string;
  agentDispatchStartedAt?: string;
  agentDispatchAcceptedAt?: string;
  agentDispatchFailedAt?: string;
  agentDispatchError?: string;
  firstWorkerOutputAt?: string;
  firstWorkerOutputKind?: "comment" | "completion";
  lastWorkerOutputAt?: string;
  lastWorkerOutputKind?: "comment" | "completion";
  lastCommentPostedAt?: string;
  lastCommentPostFailedAt?: string;
  lastCommentPostError?: string;
  completionOutputConfirmedAt?: string;
  completedAt?: string;
  completionResult?: string;
  updatedAt: string;
};

type DispatchStatusStore = Record<string, DispatchStatus>;

function storePath(workspaceDir: string): string {
  return path.join(workspaceDir, DATA_DIR, "dispatch-status.json");
}

function lockPath(workspaceDir: string): string {
  return storePath(workspaceDir) + ".lock";
}

function recordKey(projectSlug: string, issueId: number, role: string): string {
  return `${projectSlug}:${issueId}:${role}`;
}

async function acquireLock(workspaceDir: string): Promise<void> {
  const lock = lockPath(workspaceDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(path.dirname(lock), { recursive: true });
      await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
      return;
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;
      try {
        const content = await fs.readFile(lock, "utf-8");
        if (Date.now() - Number(content) > LOCK_STALE_MS) {
          try { await fs.unlink(lock); } catch {}
          continue;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  try { await fs.unlink(lock); } catch {}
  await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
}

async function releaseLock(workspaceDir: string): Promise<void> {
  try { await fs.unlink(lockPath(workspaceDir)); } catch {}
}

async function readStore(workspaceDir: string): Promise<DispatchStatusStore> {
  try {
    const raw = await fs.readFile(storePath(workspaceDir), "utf-8");
    return JSON.parse(raw) as DispatchStatusStore;
  } catch {
    return {};
  }
}

async function writeStore(workspaceDir: string, data: DispatchStatusStore): Promise<void> {
  const filePath = storePath(workspaceDir);
  const tmpPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function upsertDispatchStatus(
  workspaceDir: string,
  identity: { projectSlug: string; issueId: number; role: string },
  patch: Partial<DispatchStatus>,
): Promise<DispatchStatus> {
  await acquireLock(workspaceDir);
  try {
    const data = await readStore(workspaceDir);
    const key = recordKey(identity.projectSlug, identity.issueId, identity.role);
    const existing = data[key];
    const next = {
      ...existing,
      ...patch,
      projectSlug: identity.projectSlug,
      issueId: identity.issueId,
      role: identity.role,
      updatedAt: new Date().toISOString(),
    } as DispatchStatus;
    data[key] = next;
    await writeStore(workspaceDir, data);
    return next;
  } finally {
    await releaseLock(workspaceDir);
  }
}

export async function getDispatchStatus(
  workspaceDir: string,
  identity: { projectSlug: string; issueId: number; role: string },
): Promise<DispatchStatus | null> {
  const data = await readStore(workspaceDir);
  return data[recordKey(identity.projectSlug, identity.issueId, identity.role)] ?? null;
}

export async function findDispatchStatusBySession(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  sessionKey: string,
): Promise<DispatchStatus | null> {
  const data = await readStore(workspaceDir);
  return Object.values(data).find((entry) =>
    entry.projectSlug === projectSlug &&
    entry.issueId === issueId &&
    entry.sessionKey === sessionKey,
  ) ?? null;
}

export async function findLatestIncompleteDispatchStatusBySession(
  workspaceDir: string,
  identity: { projectSlug: string; role: string; sessionKey: string },
): Promise<DispatchStatus | null> {
  const data = await readStore(workspaceDir);
  const matches = Object.values(data)
    .filter((entry) =>
      entry.projectSlug === identity.projectSlug &&
      entry.role === identity.role &&
      entry.sessionKey === identity.sessionKey &&
      !entry.completedAt,
    )
    .sort((a, b) => {
      const aTs = Date.parse(a.updatedAt || a.labelMovedAt || "1970-01-01T00:00:00.000Z");
      const bTs = Date.parse(b.updatedAt || b.labelMovedAt || "1970-01-01T00:00:00.000Z");
      return bTs - aTs;
    });

  return matches[0] ?? null;
}

export function summarizeDispatchStatus(status: DispatchStatus | null, sessionAlive?: boolean | null): string {
  if (!status) return "unknown";
  if (status.completedAt) return "completed";
  if (status.agentDispatchFailedAt || status.sessionPatchFailedAt || status.lastCommentPostFailedAt) return "delivery_failed";
  if (status.firstWorkerOutputAt || status.completionOutputConfirmedAt) return "output_confirmed";
  if (sessionAlive) return "session_alive_waiting_for_output";
  if (status.agentDispatchAcceptedAt || status.sessionPatchSucceededAt) return "dispatched_waiting_for_output";
  return "dispatching";
}
