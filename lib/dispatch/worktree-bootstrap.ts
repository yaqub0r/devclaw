/**
 * worktree-bootstrap.ts — Canonical worker checkout/bootstrap contract text.
 */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}

export function buildIssueBranchName(issueId: number, issueTitle: string): string {
  return `issue/${issueId}-${slugify(issueTitle)}`;
}

export function buildWorktreePath(repo: string, branchName: string): string {
  return `${repo}.worktrees/${branchName}`;
}

export function buildBootstrapContractSection(opts: {
  repo: string;
  baseBranch: string;
  role: string;
  issueId: number;
  issueTitle: string;
  feedbackBranchName?: string;
}): string[] {
  const branchName = opts.feedbackBranchName || buildIssueBranchName(opts.issueId, opts.issueTitle);
  const worktreePath = buildWorktreePath(opts.repo, branchName);
  const bootstrapScript = `${opts.repo}/dev/scripts/bootstrap-issue-worktree.sh`;
  const isFeedbackCycle = !!opts.feedbackBranchName;

  const lines = [
    "",
    "## Worker checkout and bootstrap contract",
    "",
    `- Required branch: \`${branchName}\``,
    `- Required worktree: \`${worktreePath}\``,
    "- Dependency strategy: per-worktree install. Each worker worktree must provision its own `node_modules` before validation.",
    "- Bootstrap rule: run the bootstrap script below before validation. It creates or reuses the worktree and runs `npm install` when dependencies are missing or stale.",
    "",
    "```bash",
    `${bootstrapScript} ${JSON.stringify(opts.repo)} ${opts.issueId} ${JSON.stringify(opts.issueTitle)} ${JSON.stringify(opts.baseBranch)}${isFeedbackCycle ? ` ${JSON.stringify(branchName)}` : ""}`,
    "```",
    "",
    "After the script finishes, run validation from the bootstrapped worktree it prints.",
    "",
    "### Validation target",
    "",
    "- Required developer handoff target: `npm run build` passes in the worker worktree.",
    "- Best-effort target: run `npm run check` from the same worktree.",
    "- If `npm run check` fails because of pre-existing repo-wide noise unrelated to this issue, treat that as ambient validation noise, document it clearly, and do not silently convert it into an issue-local blocker.",
    "",
    "### Failure classification",
    "",
    "- `environment/bootstrap failure`: worktree creation failed, dependencies could not be installed, required local tooling is missing, or the validation environment cannot start.",
    "- `ambient validation noise`: the repo baseline is already noisy, and the failing evidence is not caused by this issue's changes.",
    "- `issue-local implementation failure`: the issue's own changes are incorrect, incomplete, or break required validation.",
    "",
    "If you must block, say which category applies in the `work_finish` summary so the issue is not misrouted.",
  ];

  if (opts.role === "tester") {
    lines.splice(
      13,
      0,
      "- Tester target: validate from a dedicated worker worktree too, not from an ambient repo checkout with unknown dependency state.",
    );
  }

  return lines;
}
