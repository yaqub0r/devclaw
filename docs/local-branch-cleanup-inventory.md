# Local branch and worktree cleanup inventory

Date: 2026-04-14

## Final target state

The intended long-lived fork branches are now:

- `yaqub0r/devclaw:main` as the fork base and sync line
- `yaqub0r/devclaw:release/devclaw-local` as the local operational line

Configured DevClaw project target:

- `baseBranch = release/devclaw-local`
- `deployBranch = release/devclaw-local`

## Migration status snapshot

At the time of this inventory:

- the main checkout is still on `release/devclaw-local-2026-04-12`
- `release/devclaw-local-2026-04-12` appears to carry the current local operational history
- `origin/main` remains the cleaner fork reference line
- several feature, test, and scratch branches still exist and should be reduced over time

## Local branch inventory

Observed local branches:

- `development/devclaw-local`
- `feature/31-prevent-duplicate-drift`
- `feature/31-workflow-integrity-guardrails`
- `feature/33-duplicate-issue-detection`
- `feature/34-pr-reconciliation`
- `feature/34-pr-workflow-reconciliation`
- `feature/35-regression-tests-workflow-integrity`
- `feature/35-workflow-integrity-regression-tests`
- `feature/35-workflow-integrity-regressions`
- `feature/44-branch-model-cleanup`
- `feature/45-audit-local-cleanup`
- `master`
- `release/devclaw-local-2026-04-12`
- `saisucks`
- `test/apply-nonmerge-release`
- `test/apply-release-to-upstream`

Observed remote branches:

- `origin/main`
- `origin/development/devclaw-local`
- `origin/release/devclaw-local-2026-04-12`
- `origin/fix/follow-up-pr-validation`
- `origin/fix/follow-up-pr-validation-v2`
- several `origin/feature/*` branches
- `upstream/main`

## Attached Git worktrees in the main DevClaw repo

Currently attached worktrees under `/home/sai/.openclaw/workspace.worktrees/`:

- `development/devclaw-local`
- `feature/31-prevent-duplicate-drift`
- `feature/31-workflow-integrity-guardrails`
- `feature/33-duplicate-issue-detection`
- `feature/34-pr-reconciliation`
- `feature/34-pr-workflow-reconciliation`
- `feature/35-regression-tests-workflow-integrity`
- `feature/35-workflow-integrity-regression-tests`
- `feature/35-workflow-integrity-regressions`
- `feature/45-audit-local-cleanup`
- `feature/44-branch-model-cleanup` (this task worktree)

Notes:

- the main checkout is not yet on the canonical branch name `release/devclaw-local`
- `development/devclaw-local` is now obsolete relative to the final two-branch target and should be retired after confirming nothing still depends on it
- several attached worktrees are clean and merged candidates, but a few remain dirty or contain unique local history

## Sibling scratch repos inside the workspace

Observed sibling repos and scratch directories likely related to prior isolation work:

- `devclaw-plugin`
- `devclaw-plugin-issue20`
- `devclaw-plugin-issue20-head`
- `devclaw-plugin-issue25-observability`
- `devclaw-plugin-issue25-validate`
- `devclaw-plugin-issue26`
- `devclaw-plugin-issue26-result-compat`
- `devclaw-plugin-issue27`
- `devclaw-plugin-issue27-task-manage-comment`
- `devclaw-plugin-issue28-notify-canary`
- `devclaw-plugin-issue28-notify-canary-docs`
- `devclaw-plugin-issue28-notify-runtime`
- `devclaw-plugin-issue29-build-provenance`
- `devclaw-plugin-notification-split`
- `devclaw-plugin-task-manage-comment`
- `devclaw-plugin-validate-clean`
- `devclaw-plugin-validate-issue20`

These are part of the broader local clutter and should be triaged deliberately before removal.

## Safe cleanup classification

### Keep as long-lived

- `main`
- `release/devclaw-local`

### Preserve for review or consolidation

Preserve until reviewed and either merged, archived, or explicitly discarded:

- `release/devclaw-local-2026-04-12` until its operational history is confirmed on `release/devclaw-local`
- `development/devclaw-local` until any remaining references are removed
- all `feature/31` to `feature/35` branches and attached worktrees that still hold unique commits or uncommitted work
- `origin/fix/follow-up-pr-validation*` related local checkouts
- issue-split repos under `devclaw-plugin-*` that are ahead of `origin/main` or still dirty

### Delete candidates after confirmation

Low-risk cleanup candidates once no PR, review, or operator workflow still depends on them:

- merged clean feature worktrees such as `feature/31-workflow-integrity-guardrails`, `feature/33-duplicate-issue-detection`, and `feature/34-pr-reconciliation`
- clean scratch repos with no unique history, such as previously identified validation clones
- temporary test branches like `test/apply-*` once their purpose is no longer needed

## Explicit risk callouts

Do **not** delete these before extracting or committing the changes:

- the main checkout on `release/devclaw-local-2026-04-12` because it is dirty
- `feature/34-pr-workflow-reconciliation` because the existing review found it dirty
- `feature/35-workflow-integrity-regression-tests` because the existing review found it dirty
- `devclaw-plugin-issue20` because it is dirty and detached
- `devclaw-plugin-issue26` because it is dirty
- `devclaw-plugin-notification-split` because it is dirty and contains local-only commits

Do **not** delete these without archival or merge confirmation, because prior review found unique history not present on `origin/main`:

- `feature/31-prevent-duplicate-drift`
- `feature/35-regression-tests-workflow-integrity`
- `feature/35-workflow-integrity-regressions`
- `devclaw-plugin-issue20-head`
- `devclaw-plugin-issue25-observability`
- `devclaw-plugin-issue25-validate`
- `devclaw-plugin-issue26-result-compat`
- `devclaw-plugin-issue27`
- `devclaw-plugin-issue27-task-manage-comment`
- `devclaw-plugin-issue28-notify-canary`
- `devclaw-plugin-issue28-notify-canary-docs`
- `devclaw-plugin-issue29-build-provenance`
- `devclaw-plugin-task-manage-comment`
- `devclaw-plugin-validate-clean`

## Recommended staged cleanup sequence

1. Create or update `release/devclaw-local` from the intended operational history.
2. Repoint worker and deployment config to `release/devclaw-local`.
3. Confirm active local PRs and issue work no longer target `main` or `development/devclaw-local`.
4. Preserve all dirty trees by committing, exporting patches, or bundling branches.
5. Delete the low-risk clean and merged candidates first.
6. Archive clean branches or scratch repos that still contain unique history.
7. Retire `development/devclaw-local` and the dated release branch once the canonical release branch is validated.
8. Continue removing stray long-lived issue and validation branches until only `main` and `release/devclaw-local` remain as intended long-lived fork branches.

## Follow-up tasks suggested

1. Verify the current operational history is fully represented on `release/devclaw-local`, then retire `release/devclaw-local-2026-04-12`.
2. Retarget or close any open PRs that still point at `main` or obsolete intermediate branches.
3. Audit attached `feature/*` worktrees for merged, superseded, and stale status, then produce a deletion batch.
4. Audit `devclaw-plugin-*` sibling repos and collapse duplicate validation or issue-split repos.
5. Remove all references to `development/devclaw-local` after confirming no worker or documentation still points there.
