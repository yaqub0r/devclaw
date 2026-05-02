/**
 * setup/workspace.ts — Workspace file scaffolding.
 *
 * On startup, ensureDefaultFiles() creates missing workspace files with curated
 * defaults. User-owned config files (workflow.yaml, prompts, IDENTITY.md) are
 * write-once: created if missing, never overwritten. Workspace-root guidance
 * files (AGENTS.md, HEARTBEAT.md, TOOLS.md) remain user-owned documents; on
 * startup DevClaw only manages its tagged section inside each file.
 *
 * The runtime config loader (lib/config/loader.ts) uses a three-layer merge with
 * built-in fallbacks, so missing keys in workflow.yaml are handled automatically.
 *
 * To explicitly write/reset defaults, use setup --eject-defaults or --reset-defaults.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  AGENTS_MD_TEMPLATE,
  HEARTBEAT_MD_TEMPLATE,
  IDENTITY_MD_TEMPLATE,
  SOUL_MD_TEMPLATE,
  TOOLS_MD_TEMPLATE,
  WORKFLOW_YAML_TEMPLATE,
  DEFAULT_PROMPT_INSTRUCTIONS,
} from "./templates.js";
import { migrateWorkspaceLayout, DATA_DIR } from "./migrate-layout.js";
import { writeVersionFile, detectUpgrade } from "./version.js";
import { log as auditLog } from "../audit.js";

/** Sentinel file indicating the workspace has been initialized. */
const INITIALIZED_SENTINEL = ".initialized";

const MANAGED_BLOCKS = {
  "AGENTS.md": {
    sectionId: "agents",
    template: AGENTS_MD_TEMPLATE,
    intro: "DevClaw manages only the tagged block below on startup. You may edit any content outside that block. If you edit inside it, DevClaw may replace those changes the next time it refreshes defaults.",
  },
  "HEARTBEAT.md": {
    sectionId: "heartbeat",
    template: HEARTBEAT_MD_TEMPLATE,
    intro: "DevClaw manages only the tagged block below on startup. Keep any custom heartbeat notes outside the managed block.",
  },
  "TOOLS.md": {
    sectionId: "tools",
    template: TOOLS_MD_TEMPLATE,
    intro: "DevClaw manages only the tagged block below on startup. Add workspace-specific tool notes outside the managed block.",
  },
} as const;

/**
 * Ensure all workspace data files are up to date.
 *
 * Called on every heartbeat startup.
 *
 * File categories:
 *   - Root guidance (AGENTS.md, HEARTBEAT.md, TOOLS.md): update/create DevClaw tagged block only
 *   - User-owned config (workflow.yaml, prompts, IDENTITY.md): create-only
 *   - Runtime state (projects.json): create-only
 */
export async function ensureDefaultFiles(workspacePath: string): Promise<void> {
  await ensureWorkspaceDataFiles(workspacePath);

  // --- Workspace-root guidance files — manage tagged DevClaw blocks only ---
  for (const [fileName, config] of Object.entries(MANAGED_BLOCKS)) {
    await upsertManagedBlock(path.join(workspacePath, fileName), config.sectionId, config.template, config.intro);
  }

  // --- User-owned files — create-only, never overwrite ---

  // IDENTITY.md
  const identityPath = path.join(workspacePath, "IDENTITY.md");
  if (!await fileExists(identityPath)) {
    await fs.writeFile(identityPath, IDENTITY_MD_TEMPLATE, "utf-8");
  }

  // Remove BOOTSTRAP.md — one-time onboarding file, not needed after setup
  try { await fs.unlink(path.join(workspacePath, "BOOTSTRAP.md")); } catch { /* already gone */ }
}

/**
 * Ensure DevClaw-owned data files exist without touching workspace-root guidance files.
 * Safe for generic runtime code paths like project reads.
 */
export async function ensureWorkspaceDataFiles(workspacePath: string): Promise<void> {
  const dataDir = path.join(workspacePath, DATA_DIR);
  await fs.mkdir(dataDir, { recursive: true });

  // Ensure directories exist
  await fs.mkdir(path.join(dataDir, "projects"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "prompts"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "log"), { recursive: true });

  // devclaw/workflow.yaml — create-only (three-layer merge handles defaults for missing keys)
  const workflowPath = path.join(dataDir, "workflow.yaml");
  await writeIfMissing(workflowPath, WORKFLOW_YAML_TEMPLATE);

  // devclaw/projects.json — create-only
  const projectsJsonPath = path.join(dataDir, "projects.json");
  await writeIfMissing(projectsJsonPath, JSON.stringify({ projects: {} }, null, 2) + "\n");

  // devclaw/prompts/ — create-only per prompt target (user customizations are preserved)
  for (const [promptName, content] of Object.entries(DEFAULT_PROMPT_INSTRUCTIONS)) {
    const promptPath = path.join(dataDir, "prompts", `${promptName}.md`);
    if (content) await writeIfMissing(promptPath, content);
  }

  // Version tracking
  const upgrade = await detectUpgrade(dataDir);
  await writeVersionFile(dataDir);
  if (upgrade) {
    await auditLog(workspacePath, "version_upgrade", {
      from: upgrade.from,
      to: upgrade.to,
    });
  }

  // Mark workspace as initialized
  const sentinelPath = path.join(dataDir, INITIALIZED_SENTINEL);
  await writeIfMissing(sentinelPath, new Date().toISOString() + "\n");
}

/**
 * Write all package defaults to workspace.
 * Used by setup --eject-defaults and --reset-defaults.
 *
 * @param force — If true, overwrite existing files (reset-defaults). If false, skip existing (eject-defaults).
 * @returns List of files written.
 */
export async function writeAllDefaults(workspacePath: string, force = false): Promise<string[]> {
  const dataDir = path.join(workspacePath, DATA_DIR);
  const written: string[] = [];

  // Ensure directories
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, "projects"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "prompts"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "log"), { recursive: true });

  const files: Array<[string, string]> = [
    [path.join(workspacePath, "AGENTS.md"), AGENTS_MD_TEMPLATE],
    [path.join(workspacePath, "HEARTBEAT.md"), HEARTBEAT_MD_TEMPLATE],
    [path.join(workspacePath, "IDENTITY.md"), IDENTITY_MD_TEMPLATE],
    [path.join(workspacePath, "TOOLS.md"), TOOLS_MD_TEMPLATE],
    [path.join(dataDir, "workflow.yaml"), WORKFLOW_YAML_TEMPLATE],
  ];

  for (const [promptName, content] of Object.entries(DEFAULT_PROMPT_INSTRUCTIONS)) {
    if (content) files.push([path.join(dataDir, "prompts", `${promptName}.md`), content]);
  }

  for (const [filePath, content] of files) {
    if (force) {
      await backupAndWrite(filePath, content);
      written.push(path.relative(workspacePath, filePath));
    } else {
      if (await writeIfMissing(filePath, content)) {
        written.push(path.relative(workspacePath, filePath));
      }
    }
  }

  // Version tracking
  const upgrade = await detectUpgrade(dataDir);
  await writeVersionFile(dataDir);
  if (upgrade) {
    await auditLog(workspacePath, "version_upgrade", {
      from: upgrade.from,
      to: upgrade.to,
    });
  }

  return written;
}

/**
 * Write all workspace files for a DevClaw agent.
 * Returns the list of files that were written (skips files that already exist).
 *
 * @param defaultWorkspacePath — If provided, USER.md is copied from here (only if not already present).
 */
export async function scaffoldWorkspace(workspacePath: string, defaultWorkspacePath?: string): Promise<string[]> {
  // Migrate old layout if detected
  await migrateWorkspaceLayout(workspacePath);

  // SOUL.md (create-only — never overwrite user customizations)
  const soulPath = path.join(workspacePath, "SOUL.md");
  if (!await fileExists(soulPath)) {
    await fs.writeFile(soulPath, SOUL_MD_TEMPLATE, "utf-8");
  }

  // USER.md — copy from default workspace if available (create-only)
  const userPath = path.join(workspacePath, "USER.md");
  if (!await fileExists(userPath) && defaultWorkspacePath) {
    const sourceUser = path.join(defaultWorkspacePath, "USER.md");
    if (await fileExists(sourceUser)) {
      await fs.copyFile(sourceUser, userPath);
    }
  }

  // Ensure directories and missing structural files
  await ensureDefaultFiles(workspacePath);

  return ["AGENTS.md", "HEARTBEAT.md", "TOOLS.md"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function backupAndWrite(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
    await fs.copyFile(filePath, filePath + ".bak");
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }
  await fs.writeFile(filePath, content, "utf-8");
}

function buildManagedBlock(sectionId: string, content: string): string {
  const start = `<!-- DEVCLAW:START ${sectionId} -->`;
  const end = `<!-- DEVCLAW:END ${sectionId} -->`;
  return `${start}\n${content.trimEnd()}\n${end}`;
}

function buildManagedNotice(sectionId: string, intro: string): string {
  return [
    `<!-- DEVCLAW:NOTICE:START ${sectionId} -->`,
    intro,
    `<!-- DEVCLAW:NOTICE:END ${sectionId} -->`,
  ].join("\n");
}

function buildManagedSection(sectionId: string, content: string, intro: string): string {
  return `${buildManagedNotice(sectionId, intro)}\n\n${buildManagedBlock(sectionId, content)}`;
}

function buildManagedFile(sectionId: string, content: string, intro: string): string {
  return `${buildManagedSection(sectionId, content, intro)}\n`;
}

function normalizeForManagedComparison(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function isLegacyManagedFullFile(originalContent: string, template: string): boolean {
  return normalizeForManagedComparison(originalContent) === normalizeForManagedComparison(template);
}

function stripManagedSection(originalContent: string, sectionId: string): string {
  const managedSectionPattern = new RegExp(
    `\n*<!-- DEVCLAW:NOTICE:START ${escapeRegExp(sectionId)} -->[\\s\\S]*?<!-- DEVCLAW:END ${escapeRegExp(sectionId)} -->\n*`,
    "m",
  );
  return originalContent.replace(managedSectionPattern, "\n");
}

function isLegacyManagedFileWithTaggedDuplicate(originalContent: string, sectionId: string, template: string): boolean {
  return isLegacyManagedFullFile(stripManagedSection(originalContent, sectionId), template);
}

function upsertManagedContent(originalContent: string, sectionId: string, content: string, intro: string): string {
  const managedBlock = buildManagedBlock(sectionId, content);
  const managedNotice = buildManagedNotice(sectionId, intro);
  const managedSection = buildManagedSection(sectionId, content, intro);
  const blockPattern = new RegExp(
    `<!-- DEVCLAW:START ${escapeRegExp(sectionId)} -->[\\s\\S]*?<!-- DEVCLAW:END ${escapeRegExp(sectionId)} -->`,
    "m",
  );
  const noticePattern = new RegExp(
    `<!-- DEVCLAW:NOTICE:START ${escapeRegExp(sectionId)} -->[\\s\\S]*?<!-- DEVCLAW:NOTICE:END ${escapeRegExp(sectionId)} -->\\n*`,
    "m",
  );

  if (
    !originalContent.trim()
    || isLegacyManagedFullFile(originalContent, content)
    || isLegacyManagedFileWithTaggedDuplicate(originalContent, sectionId, content)
  ) {
    return buildManagedFile(sectionId, content, intro);
  }

  const hasNotice = noticePattern.test(originalContent);
  const hasBlock = blockPattern.test(originalContent);

  // Step 1: seed or refresh the explanatory notice independently from block insertion.
  let nextContent = hasNotice
    ? originalContent.replace(noticePattern, `${managedNotice}\n\n`)
    : originalContent;

  if (!hasNotice && hasBlock) {
    const blockMatch = nextContent.match(blockPattern);
    if (!blockMatch || typeof blockMatch.index !== "number") {
      return nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
    }

    const beforeBlock = nextContent.slice(0, blockMatch.index).replace(/\n+$/, "");
    const afterBlock = nextContent.slice(blockMatch.index);
    nextContent = beforeBlock
      ? `${beforeBlock}\n\n${managedNotice}\n\n${afterBlock}`
      : `${managedNotice}\n\n${afterBlock}`;
  }

  // Step 2: replace or append the managed block, preserving user-owned content.
  if (hasBlock) {
    nextContent = nextContent.replace(blockPattern, managedBlock);
    return nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
  }

  const baseContent = nextContent.replace(/\n+$/, "");
  const separator = baseContent.endsWith("\n") ? "\n" : "\n\n";
  const insertedContent = hasNotice ? managedBlock : managedSection;
  return `${baseContent}${separator}${insertedContent}\n`;
}

async function upsertManagedBlock(filePath: string, sectionId: string, content: string, intro: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const existingContent = await fs.readFile(filePath, "utf-8").catch(() => "");
  const nextContent = upsertManagedContent(existingContent, sectionId, content, intro);

  if (existingContent === nextContent) return;
  await fs.writeFile(filePath, nextContent, "utf-8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Write a file only if it doesn't exist. Returns true if file was written.
 */
async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await fileExists(filePath)) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return true;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
