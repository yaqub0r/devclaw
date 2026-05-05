import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { log as auditLog } from "../audit.js";
import type { OrchestratorInterventionEvent } from "./types.js";

const MAX_EVENT_LINES = 400;

function eventPath(workspaceDir: string, projectSlug: string): string {
  return join(workspaceDir, DATA_DIR, "log", `orchestrator-events.${projectSlug}.ndjson`);
}

export async function appendInterventionEvent(
  workspaceDir: string,
  event: OrchestratorInterventionEvent,
): Promise<void> {
  const path = eventPath(workspaceDir, event.projectSlug);
  const line = JSON.stringify(event) + "\n";
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line, "utf-8");
    await truncateIfNeeded(path);
  } catch {
    // Best effort only
  }
  await auditLog(workspaceDir, "orchestrator_event", event).catch(() => {});
}

export async function readInterventionEvents(opts: {
  workspaceDir: string;
  projectSlug: string;
  issueId?: number;
  limit?: number;
}): Promise<OrchestratorInterventionEvent[]> {
  const path = eventPath(opts.workspaceDir, opts.projectSlug);
  try {
    const raw = await readFile(path, "utf-8");
    const entries = raw.split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as OrchestratorInterventionEvent;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is OrchestratorInterventionEvent => entry !== null);

    const filtered = opts.issueId == null
      ? entries
      : entries.filter((entry) => entry.issueId === opts.issueId);
    return filtered.slice(-(opts.limit ?? 25));
  } catch {
    return [];
  }
}

async function truncateIfNeeded(path: string): Promise<void> {
  try {
    const raw = await readFile(path, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= MAX_EVENT_LINES) return;
    const kept = lines.slice(-MAX_EVENT_LINES).join("\n") + "\n";
    await writeFile(path, kept, "utf-8");
  } catch {
    // Ignore
  }
}
