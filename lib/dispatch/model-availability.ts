import type { PluginRuntime } from "openclaw/plugin-sdk";

type ModelCatalogRuntime = {
  gateway?: {
    request<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      options?: { timeoutMs?: number },
    ): Promise<T>;
  };
  subagent?: {
    run(params: Record<string, unknown>): Promise<{ runId: string }>;
  };
};

type ModelCatalogRow = {
  id?: unknown;
  model?: unknown;
  provider?: unknown;
};

type ModelCatalogSnapshot = {
  expiresAt: number;
  refs: Set<string> | null;
};

const MODEL_CATALOG_CACHE_MS = 60_000;
const modelCatalogCache = new WeakMap<object, ModelCatalogSnapshot>();

function normalizeModelRef(value: string): string {
  return value.trim().toLowerCase();
}

function parseConfiguredModelRefs(result: unknown): Set<string> | null {
  if (!result || typeof result !== "object") return null;
  const models = (result as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;

  const refs = new Set<string>();
  for (const entry of models) {
    if (typeof entry === "string") {
      refs.add(normalizeModelRef(entry));
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const row = entry as ModelCatalogRow;
    const id = typeof row.id === "string"
      ? row.id
      : typeof row.model === "string"
        ? row.model
        : undefined;
    if (!id) continue;
    refs.add(normalizeModelRef(id));
    if (typeof row.provider === "string" && !id.includes("/")) {
      refs.add(normalizeModelRef(`${row.provider}/${id}`));
    }
  }
  return refs;
}

async function getConfiguredModelRefs(
  runtime: ModelCatalogRuntime,
  timeoutMs: number | undefined,
): Promise<Set<string> | null> {
  if (!runtime.gateway?.request) return null;
  const cacheKey = runtime as object;
  const cached = modelCatalogCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.refs;

  try {
    const result = await runtime.gateway.request(
      "models.list",
      { view: "configured" },
      { timeoutMs },
    );
    const refs = parseConfiguredModelRefs(result);
    modelCatalogCache.set(cacheKey, {
      expiresAt: Date.now() + MODEL_CATALOG_CACHE_MS,
      refs,
    });
    return refs;
  } catch {
    // Catalog inspection is an optimization, not the source of truth. The
    // awaited sessions.patch remains the authoritative provisioning check.
    return null;
  }
}

/**
 * Reject a definitively unavailable configured model before the issue leaves
 * its queue. Unknown/older gateway response shapes fail open; sessions.patch
 * remains the authoritative accepted-launch check.
 */
export async function assertConfiguredModelAvailable(
  model: string,
  opts: {
    runtime?: PluginRuntime;
    timeoutMs?: number;
    projectName: string;
    role: string;
    level: string;
  },
): Promise<void> {
  const runtime = opts.runtime as unknown as ModelCatalogRuntime | undefined;
  if (!runtime?.subagent?.run) return;

  const refs = await getConfiguredModelRefs(runtime, opts.timeoutMs);
  if (refs === null) return;

  const requested = normalizeModelRef(model);
  const requestedId = requested.includes("/")
    ? requested.slice(requested.indexOf("/") + 1)
    : requested;
  if (refs.has(requested) || (!requested.includes("/") && refs.has(requestedId))) {
    return;
  }

  throw new Error(
    `Configured model unavailable for ${opts.projectName} ${opts.role}/${opts.level}: ${model}. ` +
    "Configure this exact model in OpenClaw or override the project role/level model before dispatch.",
  );
}
