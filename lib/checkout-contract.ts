/**
 * checkout-contract.ts — Canonical checkout contract resolution and enforcement.
 */
import path from "node:path";
import type { RunCommand } from "./context.js";
import type { Project } from "./projects/types.js";

export type CheckoutMode = "issue" | "review" | "pr" | "live" | "release";
export type CheckoutStatus = "planned" | "created" | "adopted" | "missing" | "dirty" | "mismatched" | "verified";

export type CheckoutProvenance = {
  verifiedAt: string;
  path: string;
  branch: string | null;
  headSha: string | null;
  clean: boolean;
  status: CheckoutStatus;
  details?: string;
};

export type IssueCheckoutContract = {
  issueId: number;
  issueTitle?: string;
  mode: CheckoutMode;
  repoPath: string;
  canonicalBranch: string;
  canonicalWorktreePath: string;
  baseBranch: string;
  baseWorktreePath: string;
  targetRef: string;
  targetSha: string | null;
  requiredCleanliness: "clean" | "allow-derived-dirty";
  status: CheckoutStatus;
  lastVerifiedProvenance?: CheckoutProvenance;
};

export function slugifyIssueTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "task";
}

export function getImplementationBaseBranch(project: Project): string {
  return project.name === "devclaw" ? "devclaw-local-dev" : project.baseBranch;
}

export function getReleaseBranch(project: Project): string {
  return project.name === "devclaw" ? "devclaw-local-current" : project.baseBranch;
}

export function inferCheckoutMode(role: string, issueTitle: string, prBranchName?: string): CheckoutMode {
  const branch = prBranchName ?? "";
  if (branch.startsWith("review/")) return "review";
  if (branch.startsWith("pr/")) return "pr";
  const title = issueTitle.toLowerCase();
  if (title.includes("self-host") || title.includes("self host") || title.includes("live ")) return "live";
  if (title.includes("release") || title.includes("promotion")) return "release";
  return role === "developer" ? "issue" : "issue";
}

function deriveWorktreeRoot(repoPath: string): string {
  if (repoPath.includes(".worktrees/")) {
    return repoPath.slice(0, repoPath.indexOf(".worktrees/")) + ".worktrees";
  }
  return `${repoPath}.worktrees`;
}

function branchPath(branch: string): string {
  return branch;
}

export function resolveExpectedCheckoutContract(opts: {
  project: Project;
  issueId: number;
  issueTitle: string;
  repoPath: string;
  role: string;
  mode?: CheckoutMode;
  prBranchName?: string;
  targetSha?: string | null;
}): IssueCheckoutContract {
  const mode = opts.mode ?? inferCheckoutMode(opts.role, opts.issueTitle, opts.prBranchName);
  const worktreeRoot = deriveWorktreeRoot(opts.repoPath);
  const issueSlug = slugifyIssueTitle(opts.issueTitle);
  const canonicalBranch = mode === "issue"
    ? `issue/${opts.issueId}-${issueSlug}`
    : opts.prBranchName ?? `${mode}/${opts.issueId}-${issueSlug}`;
  const implementationBaseBranch = getImplementationBaseBranch(opts.project);
  const releaseBranch = getReleaseBranch(opts.project);
  const baseBranch = mode === "issue" ? implementationBaseBranch : (mode === "release" || mode === "live" ? releaseBranch : canonicalBranch);
  const baseWorktreePath = mode === "issue"
    ? path.join(worktreeRoot, implementationBaseBranch)
    : mode === "release" || mode === "live"
      ? path.join(worktreeRoot, releaseBranch)
      : path.join(worktreeRoot, branchPath(canonicalBranch));

  return {
    issueId: opts.issueId,
    issueTitle: opts.issueTitle,
    mode,
    repoPath: opts.repoPath,
    canonicalBranch,
    canonicalWorktreePath: path.join(worktreeRoot, branchPath(canonicalBranch)),
    baseBranch,
    baseWorktreePath,
    targetRef: mode === "issue" ? implementationBaseBranch : canonicalBranch,
    targetSha: opts.targetSha ?? null,
    requiredCleanliness: mode === "issue" ? "clean" : "allow-derived-dirty",
    status: "planned",
  };
}

async function git(runCommand: RunCommand, cwd: string, ...args: string[]): Promise<string> {
  const result = await runCommand(["git", ...args], { cwd, timeoutMs: 15_000 });
  return result.stdout.trim();
}

export async function inspectCheckoutContract(contract: IssueCheckoutContract, runCommand: RunCommand): Promise<CheckoutProvenance> {
  const verifiedAt = new Date().toISOString();
  try {
    const branch = await git(runCommand, contract.canonicalWorktreePath, "branch", "--show-current");
    const headSha = await git(runCommand, contract.canonicalWorktreePath, "rev-parse", "HEAD");
    const statusOut = await git(runCommand, contract.canonicalWorktreePath, "status", "--porcelain");
    const clean = statusOut.length === 0;
    const branchOk = branch === contract.canonicalBranch;
    const status: CheckoutStatus = !branchOk ? "mismatched" : (!clean && contract.requiredCleanliness === "clean") ? "dirty" : "verified";
    return {
      verifiedAt,
      path: contract.canonicalWorktreePath,
      branch: branch || null,
      headSha: headSha || null,
      clean,
      status,
      details: branchOk ? undefined : `expected ${contract.canonicalBranch}, got ${branch || "(detached)"}`,
    };
  } catch (error) {
    return {
      verifiedAt,
      path: contract.canonicalWorktreePath,
      branch: null,
      headSha: null,
      clean: false,
      status: "missing",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureCheckoutContract(contract: IssueCheckoutContract, runCommand: RunCommand): Promise<IssueCheckoutContract> {
  let provenance = await inspectCheckoutContract(contract, runCommand);
  if (provenance.status === "missing" && contract.mode === "issue") {
    await runCommand(["git", "worktree", "add", contract.canonicalWorktreePath, "-B", contract.canonicalBranch, contract.baseBranch], {
      cwd: contract.repoPath,
      timeoutMs: 30_000,
    });
    provenance = await inspectCheckoutContract(contract, runCommand);
    return { ...contract, status: provenance.status === "verified" ? "created" : provenance.status, lastVerifiedProvenance: provenance, targetSha: provenance.headSha };
  }
  return { ...contract, status: provenance.status === "verified" ? "adopted" : provenance.status, lastVerifiedProvenance: provenance, targetSha: provenance.headSha };
}

export function renderCheckoutRecoveryGuidance(contract: IssueCheckoutContract): string[] {
  return [
    "",
    "### Checkout Recovery",
    `- Required path: \`${contract.canonicalWorktreePath}\``,
    `- Required branch: \`${contract.canonicalBranch}\``,
    `- Base branch: \`${contract.baseBranch}\``,
    "- If the path is missing, recreate it with the exact canonical branch/worktree.",
    "- If the worktree is dirty or on the wrong branch, stop and call work_finish with result \"blocked\" unless you can repair it deterministically.",
  ];
}
