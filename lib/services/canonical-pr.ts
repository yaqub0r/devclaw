import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";
import type { IssueProvider, PrIdentity, PrStatus } from "../providers/provider.js";

export type CanonicalPrRecord = {
  issueId: number;
  number: number;
  url: string;
  sourceBranch?: string;
  repo?: string;
  status: PrStatus["state"];
  updatedAt: string;
  supersededPrs: Array<{
    number: number;
    url: string;
    sourceBranch?: string;
    repo?: string;
    supersededAt: string;
    reason: "replacement" | "reconciliation";
  }>;
};

type CanonicalPrStore = {
  issues: Record<string, CanonicalPrRecord>;
};

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

type CanonicalPrMutationResult<T> = {
  store: CanonicalPrStore;
  result: T;
};

function storePath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, "pr-ledger", `${projectSlug}.json`);
}

function lockPath(workspaceDir: string, projectSlug: string): string {
  return `${storePath(workspaceDir, projectSlug)}.lock`;
}

async function readStore(workspaceDir: string, projectSlug: string): Promise<CanonicalPrStore> {
  const filePath = storePath(workspaceDir, projectSlug);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CanonicalPrStore>;
    return { issues: parsed.issues ?? {} };
  } catch {
    return { issues: {} };
  }
}

async function writeStore(workspaceDir: string, projectSlug: string, store: CanonicalPrStore): Promise<void> {
  const filePath = storePath(workspaceDir, projectSlug);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireStoreLock(workspaceDir: string, projectSlug: string): Promise<() => Promise<void>> {
  const filePath = storePath(workspaceDir, projectSlug);
  const dir = path.dirname(filePath);
  const lockDir = lockPath(workspaceDir, projectSlug);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  await fs.mkdir(dir, { recursive: true });

  while (true) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(path.join(lockDir, "owner"), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + "\n", "utf-8");
      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring canonical PR ledger lock for project ${projectSlug}.`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function mutateStore<T>(
  workspaceDir: string,
  projectSlug: string,
  mutate: (store: CanonicalPrStore) => CanonicalPrMutationResult<T>,
): Promise<T> {
  const release = await acquireStoreLock(workspaceDir, projectSlug);
  try {
    const store = await readStore(workspaceDir, projectSlug);
    const { store: nextStore, result } = mutate(store);
    await writeStore(workspaceDir, projectSlug, nextStore);
    return result;
  } finally {
    await release();
  }
}

export async function loadCanonicalPrRecord(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
): Promise<CanonicalPrRecord | null> {
  const store = await readStore(workspaceDir, projectSlug);
  return store.issues[String(issueId)] ?? null;
}

export async function saveCanonicalPrRecord(
  workspaceDir: string,
  projectSlug: string,
  record: CanonicalPrRecord,
): Promise<void> {
  await mutateStore(workspaceDir, projectSlug, (store) => {
    store.issues[String(record.issueId)] = record;
    return { store, result: undefined };
  });
}

function samePr(a: { url?: string; number?: number }, b: { url?: string; number?: number }): boolean {
  return (!!a.url && !!b.url && a.url === b.url) || (!!a.number && !!b.number && a.number === b.number);
}

function toRecord(issueId: number, pr: PrIdentity, status: PrStatus["state"], previous?: CanonicalPrRecord): CanonicalPrRecord {
  const now = new Date().toISOString();
  const supersededPrs = [...(previous?.supersededPrs ?? [])];
  if (previous && !samePr(previous, pr)) {
    supersededPrs.push({
      number: previous.number,
      url: previous.url,
      sourceBranch: previous.sourceBranch,
      repo: previous.repo,
      supersededAt: now,
      reason: "replacement",
    });
  }
  return {
    issueId,
    number: pr.number,
    url: pr.url,
    sourceBranch: pr.sourceBranch,
    repo: pr.repo,
    status,
    updatedAt: now,
    supersededPrs,
  };
}

export async function recordCanonicalPr(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  pr: PrIdentity,
  status: PrStatus["state"],
): Promise<CanonicalPrRecord> {
  return mutateStore(workspaceDir, projectSlug, (store) => {
    const previous = store.issues[String(issueId)];
    const next = toRecord(issueId, pr, status, previous);
    store.issues[String(issueId)] = next;
    return { store, result: next };
  });
}

export async function refreshCanonicalPrStatus(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  status: PrStatus,
): Promise<CanonicalPrRecord | null> {
  return mutateStore(workspaceDir, projectSlug, (store) => {
    const existing = store.issues[String(issueId)];
    if (!existing) return { store, result: null };
    const updated: CanonicalPrRecord = {
      ...existing,
      status: status.state,
      updatedAt: new Date().toISOString(),
      sourceBranch: status.sourceBranch ?? existing.sourceBranch,
      number: status.number ?? existing.number,
    };
    store.issues[String(issueId)] = updated;
    return { store, result: updated };
  });
}

export async function resolveCanonicalPrForIssue(opts: {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  provider: IssueProvider;
  allowBackfill?: boolean;
}): Promise<CanonicalPrRecord> {
  const { workspaceDir, projectSlug, issueId, provider, allowBackfill = true } = opts;
  const existing = await loadCanonicalPrRecord(workspaceDir, projectSlug, issueId);
  const linked = await provider.getLinkedPrs(issueId);

  if (existing) {
    if (linked.length === 0) {
      throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: stored PR ${existing.url} is no longer linked to the issue.`);
    }
    const stillLinked = linked.some((pr) => samePr(pr, existing));
    if (!stillLinked) {
      const linkedSummary = linked.map((pr) => pr.url).join(", ");
      throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: stored PR ${existing.url} is not in the issue's current linked PR set (${linkedSummary}).`);
    }
    const status = await provider.getPrStatusByUrl(existing.url);
    if (!status) {
      throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: stored PR ${existing.url} no longer resolves.`);
    }
    return (await refreshCanonicalPrStatus(workspaceDir, projectSlug, issueId, status)) ?? existing;
  }

  if (linked.length !== 1 || !allowBackfill) {
    const summary = linked.length === 0 ? "no linked PR found" : `${linked.length} linked PRs found`;
    throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: ${summary}. Operator must set or recreate a single canonical PR.`);
  }

  const status = await provider.getPrStatusByUrl(linked[0]!.url);
  if (!status) {
    throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: linked PR ${linked[0]!.url} could not be resolved.`);
  }
  return recordCanonicalPr(workspaceDir, projectSlug, issueId, linked[0]!, status.state);
}

export async function resolveDeveloperCanonicalPr(opts: {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  provider: IssueProvider;
  explicitPrUrl?: string;
}): Promise<CanonicalPrRecord> {
  const { workspaceDir, projectSlug, issueId, provider, explicitPrUrl } = opts;
  const linked = await provider.getLinkedPrs(issueId);
  if (linked.length === 0) {
    throw new Error(`Cannot mark work_finish(done) without an open PR. No PR is linked to issue #${issueId}.`);
  }

  let chosen: PrIdentity | null = null;
  if (explicitPrUrl) {
    chosen = linked.find((pr) => pr.url === explicitPrUrl) ?? await provider.getPrByUrl(explicitPrUrl);
    if (!chosen || !linked.some((pr) => samePr(pr, chosen!))) {
      throw new Error(`Canonical PR routing is ambiguous for issue #${issueId}: explicit prUrl ${explicitPrUrl} is not one of the issue-linked PRs.`);
    }
  } else if (linked.length === 1) {
    chosen = linked[0]!;
  } else {
    throw new Error(`Canonical PR routing is ambiguous for issue #${issueId}: ${linked.length} linked PRs exist and no explicit prUrl was provided.`);
  }

  const existing = await loadCanonicalPrRecord(workspaceDir, projectSlug, issueId);
  if (existing && !samePr(existing, chosen)) {
    if (!explicitPrUrl) {
      throw new Error(`Canonical PR routing is ambiguous for issue #${issueId}: existing canonical PR ${existing.url} differs from the newly discovered PR ${chosen.url}. Provide prUrl explicitly to supersede it.`);
    }
  }

  const status = await provider.getPrStatusByUrl(chosen.url);
  if (!status) {
    throw new Error(`Canonical PR routing integrity failure for issue #${issueId}: ${chosen.url} could not be resolved.`);
  }

  return recordCanonicalPr(workspaceDir, projectSlug, issueId, chosen, status.state);
}
