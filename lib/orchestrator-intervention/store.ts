import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";
import type { OrchestratorInterventionPolicy, OrchestratorInterventionStore } from "./types.js";

function storePath(workspaceDir: string, projectSlug: string): string {
  return join(workspaceDir, DATA_DIR, "interventions", `${projectSlug}.json`);
}

export async function loadInterventionStore(
  workspaceDir: string,
  projectSlug: string,
): Promise<OrchestratorInterventionStore> {
  const path = storePath(workspaceDir, projectSlug);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as OrchestratorInterventionStore;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      policies: Array.isArray(parsed.policies) ? parsed.policies : [],
    };
  } catch {
    return { version: 1, updatedAt: new Date(0).toISOString(), policies: [] };
  }
}

export async function saveInterventionStore(
  workspaceDir: string,
  projectSlug: string,
  store: OrchestratorInterventionStore,
): Promise<void> {
  const path = storePath(workspaceDir, projectSlug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export async function upsertInterventionPolicy(
  workspaceDir: string,
  projectSlug: string,
  policy: Omit<OrchestratorInterventionPolicy, "updatedAt">,
): Promise<OrchestratorInterventionPolicy> {
  const store = await loadInterventionStore(workspaceDir, projectSlug);
  const next: OrchestratorInterventionPolicy = {
    ...policy,
    enabled: policy.enabled ?? true,
    mode: policy.mode ?? "auto",
    updatedAt: new Date().toISOString(),
  };
  const idx = store.policies.findIndex((p) => p.id === next.id);
  if (idx >= 0) store.policies[idx] = next;
  else store.policies.push(next);
  store.updatedAt = next.updatedAt;
  await saveInterventionStore(workspaceDir, projectSlug, store);
  return next;
}

export async function deleteInterventionPolicy(
  workspaceDir: string,
  projectSlug: string,
  policyId: string,
): Promise<boolean> {
  const store = await loadInterventionStore(workspaceDir, projectSlug);
  const before = store.policies.length;
  store.policies = store.policies.filter((p) => p.id !== policyId);
  if (store.policies.length === before) return false;
  store.updatedAt = new Date().toISOString();
  await saveInterventionStore(workspaceDir, projectSlug, store);
  return true;
}
