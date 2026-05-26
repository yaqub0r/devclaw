# Worker worktree bootstrap contract

This design closes the gap between ordinary implementation work and the local checkout state that worker validation depends on.

Related issues:
- #171, workers can validate different checkouts and silently disagree on results
- #174, canonical issue checkout contract and worktree lifecycle enforcement
- #238, bootstrap worker issue worktrees and separate environment failures from implementation blockers

## Contract

### 1. Dedicated worker worktrees are required

Developer and tester validation must run from dedicated worker worktrees, not from an ambient checkout whose dependency state is unknown.

### 2. Branch naming is canonical

Default implementation branch:
- `issue/<issue-id>-<slug>`

Feedback-cycle branch:
- reuse the existing PR branch exactly as given in PR feedback

### 3. Dependency strategy is per-worktree install

Each worker worktree provisions its own `node_modules`.

Why:
- it avoids hidden dependence on some other checkout's install state
- it makes validation reproducible per worker
- it keeps the failure surface local to the worktree instead of leaking across branches

### 4. Bootstrap is a first-class step

Workers should use:
- `dev/scripts/bootstrap-issue-worktree.sh`

The script:
- creates or reuses the canonical worktree
- reuses an existing local branch when present
- creates the branch from the configured base branch otherwise
- runs `npm install` when dependencies are missing or stale

## Validation target

Minimum developer handoff target:
- `npm run build` passes in the worker worktree

Best-effort target:
- `npm run check`

If the repository baseline is already noisy, workers should distinguish that noise from issue-local failures instead of misclassifying it as a product blocker for the issue.

## Failure classes

### environment/bootstrap failure

Examples:
- worktree creation failure
- dependency install failure
- missing local tooling
- validation command cannot start because the local environment is incomplete

These are setup problems. They should not silently present as issue-specific product failures.

### ambient validation noise

Examples:
- pre-existing repo-wide `npm run check` failures unrelated to the issue
- flaky unrelated checks already failing on the same base before the issue changes

These should be reported explicitly as baseline noise.

### issue-local implementation failure

Examples:
- the issue's own changes fail `npm run build`
- the fix is incomplete
- the issue changes cause validation regressions in touched scope

These are real implementation blockers.

## Messaging rule

Blocked or hold summaries should state which category applies:
- `environment/bootstrap failure`
- `ambient validation noise`
- `issue-local implementation failure`

That keeps Refining or follow-up discussion focused on the real problem.
