/**
 * build-provenance.ts — Embedded live runtime provenance for built DevClaw installs.
 *
 * Build-time metadata is injected by esbuild so live installs remain self-describing
 * even if the original source checkout/worktree is no longer available.
 */
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Injected at build time by esbuild (see build.mjs). */
declare const __PLUGIN_VERSION__: string | undefined;
declare const __PACKAGE_NAME__: string | undefined;
declare const __BUILD_PROVENANCE__: string | undefined;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export type BuildProvenance = {
  packageName: string;
  packageVersion: string;
  commitSha: string | null;
  shortCommitSha: string | null;
  branch: string | null;
  dirty: boolean | null;
  buildTimestamp: string | null;
  source: "embedded" | "fallback";
};

function readPackageFallback(): { packageName: string; packageVersion: string } {
  try {
    const pkgPath = path.join(THIS_DIR, "..", "..", "package.json");
    const pkg = JSON.parse(fsSync.readFileSync(pkgPath, "utf-8"));
    return {
      packageName: pkg.name ?? "devclaw",
      packageVersion: pkg.version ?? "0.0.0",
    };
  } catch {
    return {
      packageName: typeof __PACKAGE_NAME__ !== "undefined" && __PACKAGE_NAME__ ? __PACKAGE_NAME__ : "devclaw",
      packageVersion: typeof __PLUGIN_VERSION__ !== "undefined" && __PLUGIN_VERSION__ ? __PLUGIN_VERSION__ : "0.0.0",
    };
  }
}

export function getBuildProvenance(): BuildProvenance {
  const fallbackPkg = readPackageFallback();

  if (typeof __BUILD_PROVENANCE__ !== "undefined" && __BUILD_PROVENANCE__) {
    try {
      const parsed = JSON.parse(__BUILD_PROVENANCE__) as Omit<BuildProvenance, "source">;
      return {
        ...parsed,
        source: "embedded",
      };
    } catch {
      // Fall through to safe fallback.
    }
  }

  return {
    packageName: fallbackPkg.packageName,
    packageVersion: fallbackPkg.packageVersion,
    commitSha: null,
    shortCommitSha: null,
    branch: null,
    dirty: null,
    buildTimestamp: null,
    source: "fallback",
  };
}

export function formatBuildProvenanceSummary(provenance = getBuildProvenance()): string {
  const dirtyText = provenance.dirty === null ? "unknown" : provenance.dirty ? "dirty" : "clean";
  const commitText = provenance.commitSha ?? "unknown commit";
  const branchText = provenance.branch ?? "unknown branch";
  const builtAtText = provenance.buildTimestamp ?? "unknown build time";

  return `${provenance.packageName}@${provenance.packageVersion} (${commitText}, ${branchText}, ${dirtyText}, built ${builtAtText})`;
}
