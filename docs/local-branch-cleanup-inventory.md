# Local branch and worktree cleanup inventory

Date: 2026-04-14

## Current policy target

The intended active local integration branch is:

- `development/devclaw-local`

Configured DevClaw project target (`devclaw/projects.json`):

- `baseBranch = development/devclaw-local`
- `deployBranch = development/devclaw-local`

## Important current mismatch

At the time of this inventory:

- the local repo checkout is still on `release/devclaw-local-2026-04-12`
- `development/devclaw-local` does **not** currently exist as a local branch
- `origin/development/devclaw-local` does **not** currently exist as a remote branch

This means branch-policy documentation and project config have been updated, but the actual Git branch migration is not complete yet.

## Local branch inventory

Current local branches observed:

- `release/devclaw-local-2026-04-12` (current checked out branch)
- `master`
- `saisucks`
- `test/apply-nonmerge-release`
- `test/apply-release-to-upstream`
- `feature/31-prevent-duplicate-drift`
- `feature/31-workflow-integrity-guardrails`
- `feature/33-duplicate-issue-detection`
- `feature/34-pr-reconciliation`
- `feature/34-pr-workflow-reconciliation`
- `feature/35-regression-tests-workflow-integrity`
- `feature/35-workflow-integrity-regression-tests`
- `feature/35-workflow-integrity-regressions`

Current remotes observed:

- `origin/main`
- `origin/release/devclaw-local-2026-04-12`
- `origin/fix/follow-up-pr-validation`
- `origin/fix/follow-up-pr-validation-v2`
- several `origin/feature/*` workflow-fix branches
- `upstream/main`

## Attached Git worktrees in the main DevClaw repo

Currently attached worktrees:

- main checkout on `release/devclaw-local-2026-04-12`
- `feature/31-prevent-duplicate-drift`
- `feature/31-workflow-integrity-guardrails`
- `feature/33-duplicate-issue-detection`
- `feature/34-pr-reconciliation`
- `feature/34-pr-workflow-reconciliation`
- `feature/35-regression-tests-workflow-integrity`
- `feature/35-workflow-integrity-regression-tests`
- `feature/35-workflow-integrity-regressions`

Notes:

- These worktrees are attached under `/home/sai/.openclaw/workspace.worktrees/`
- `feature/34-pr-workflow-reconciliation` currently points at the same commit as the main checkout, which makes it a good candidate for review during cleanup
- none of these attached worktrees currently represent the intended `development/devclaw-local` integration lane

## Nested sibling repos / scratch worktrees inside the workspace

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

Status notes from quick inspection:

- several are detached-head validation worktrees
- several are issue-split branches ahead of `origin/main`
- several still have uncommitted changes and should be reviewed before deletion
- these are not attached worktrees of the main DevClaw repo, but they are part of the broader local clutter and should be triaged deliberately

## Safe cleanup classification

### Preserve for now

Preserve until reviewed and either merged, archived, or explicitly discarded:

- all `feature/31` to `feature/35` branches and attached worktrees
- `release/devclaw-local-2026-04-12`
- `origin/fix/follow-up-pr-validation*` related local checkouts
- issue-split repos under `devclaw-plugin-*` that are ahead of `origin/main`

### Review for possible archive or deletion after confirmation

Candidates for cleanup review once their value is confirmed:

- detached validation worktrees (`*-validate*`, `*-head`)
- duplicate or superseded split repos for the same issue bucket
- test branches (`test/apply-*`)
- ad-hoc local branches such as `saisucks` if they are no longer needed
- legacy `master` if it is unused and redundant

## Recommended staged cleanup sequence

1. Create the actual branch `development/devclaw-local` from the intended source commit.
2. Push it to `origin`.
3. Repoint any active operational work and future PRs to that branch.
4. Decide whether `release/devclaw-local-2026-04-12` stays as a frozen release marker.
5. Triage attached `feature/*` worktrees: merge, archive, or delete.
6. Triage `devclaw-plugin-*` sibling repos: keep only active issue-isolation worktrees.
7. Remove obsolete scratch directories only after confirming there are no unpushed commits or needed local diffs.

## Follow-up tasks suggested

1. Create and publish `development/devclaw-local`, then retarget any open local operational PRs.
2. Audit attached `feature/*` worktrees for merged/superseded/stale status and produce a safe delete list.
3. Audit `devclaw-plugin-*` sibling repos and collapse duplicate validation/split worktrees.
4. Optionally document a naming convention for temporary validation worktrees so future cleanup is easier.

## Reviewed cleanup plan (issue #45)

Review date: 2026-04-14

### Attached worktrees

| Path / branch | Status signals | Recommendation | Why |
| --- | --- | --- | --- |
| `workspace` on `release/devclaw-local-2026-04-12` | **dirty**, not compared to upstream, local config/docs edits present | **keep** | Active main checkout with uncommitted work. Not safe to archive or delete. |
| `workspace.worktrees/development/devclaw-local` | clean, tracks `origin/development/devclaw-local`, ahead 0 / behind 0 | **keep** | This is the intended integration lane and should remain attached. |
| `feature/31-prevent-duplicate-drift` | clean, tracks remote, **2 commits ahead of `origin/main`**, not merged to `origin/main` | **archive after review** | No dirt, but contains unique branch work. Safe delete would risk losing issue #31 history unless merged or bundled first. |
| `feature/31-workflow-integrity-guardrails` | clean, tracks remote, merged to `origin/main` | **delete candidate** | Clean and merged, so low-risk cleanup once confirmed no PR/review context still needs local checkout. |
| `feature/33-duplicate-issue-detection` | clean, tracks remote, merged to `origin/main` | **delete candidate** | Same as above. |
| `feature/34-pr-reconciliation` | clean, tracks remote, merged to `origin/main` | **delete candidate** | Same as above. |
| `feature/34-pr-workflow-reconciliation` | **dirty**, no usable upstream signal, same HEAD as release checkout | **keep** | The branch itself is merged-equivalent, but the worktree contains uncommitted changes, so deletion is unsafe until diff is reviewed or moved elsewhere. |
| `feature/35-regression-tests-workflow-integrity` | clean, tracks remote, **3 commits ahead of `origin/main`**, not merged to `origin/main` | **archive after review** | Unique local/branch history is still present. Preserve until merged, tagged, or exported. |
| `feature/35-workflow-integrity-regression-tests` | **dirty**, tracks remote, branch merged to `origin/main` | **keep** | Merged branch, but worktree has uncommitted test edits. Unsafe to delete before triage. |
| `feature/35-workflow-integrity-regressions` | clean, tracks remote, **2 commits ahead of `origin/main`**, not merged to `origin/main` | **archive after review** | Holds unique regression-history commits and should not be dropped casually. |

### Sibling `devclaw-plugin-*` repos

| Repo | Status signals | Recommendation | Why |
| --- | --- | --- | --- |
| `devclaw-plugin-issue20` | **dirty detached HEAD**, staged/unstaged changes in audit and workflow observability files | **keep** | Highest-risk cleanup target. Contains live uncommitted work. |
| `devclaw-plugin-issue20-head` | clean detached HEAD, **3 commits ahead of `origin/main`** | **archive after review** | Detached validation snapshot, but it points at unique local history. Preserve before cleanup. |
| `devclaw-plugin-issue25-observability` | clean branch, tracks `origin/main`, **ahead by 6** | **archive after review** | Significant unmerged split branch. Preserve unless intentionally squashed or merged. |
| `devclaw-plugin-issue25-validate` | clean detached HEAD, **4 commits ahead of `origin/main`** | **archive after review** | Validation clone with unique history. Archive or merge, not delete blind. |
| `devclaw-plugin-issue26` | branch tracks `origin/main`, **dirty working tree** | **keep** | Uncommitted result-compat changes exist locally. |
| `devclaw-plugin-issue26-result-compat` | clean branch, tracks `origin/main`, **ahead by 2** | **archive after review** | Contains isolated issue #26 commits. |
| `devclaw-plugin-issue27` | clean branch, **2 commits ahead of `origin/main`** | **archive after review** | Local task-manage-comment work still exists only here. |
| `devclaw-plugin-issue27-task-manage-comment` | clean branch, tracks `origin/main`, **ahead by 1** | **archive after review** | Probably superseded by the fuller issue27 repo, but still unique history. |
| `devclaw-plugin-issue28-notify-canary` | clean branch, tracks `origin/main`, **ahead by 1** | **archive after review** | Unique split branch state. |
| `devclaw-plugin-issue28-notify-canary-docs` | clean branch, tracks `origin/main`, **ahead by 1** | **archive after review** | Docs-only split, low risk after archival, but still unique. |
| `devclaw-plugin-issue28-notify-runtime` | clean branch, no local-only commits vs `origin/main` | **delete candidate** | No dirty state and no unique history detected. Best low-risk sibling cleanup target. |
| `devclaw-plugin-issue29-build-provenance` | clean branch, tracks `origin/main`, **ahead by 1** | **archive after review** | Unique split branch history remains. |
| `devclaw-plugin-notification-split` | **dirty branch**, **3 commits ahead of `origin/main`** | **keep** | Mixed dirty state plus unique local history. Do not delete. |
| `devclaw-plugin-task-manage-comment` | clean branch, **4 commits ahead of `origin/main`** | **archive after review** | Strong archive candidate, not delete candidate. |
| `devclaw-plugin-validate-clean` | clean detached HEAD, **3 commits ahead of `origin/main`** | **archive after review** | Detached validation checkout with unique local commits. |
| `devclaw-plugin-validate-issue20` | clean detached HEAD, no local-only commits vs `origin/main` | **delete candidate** | Clean validation clone with no unique commits detected. Lowest-risk detached cleanup target. |

### Explicit risk callouts

Do **not** delete these before extracting or committing the changes:

- `workspace` (`release/devclaw-local-2026-04-12`) because it is dirty
- `feature/34-pr-workflow-reconciliation` because it is dirty
- `feature/35-workflow-integrity-regression-tests` because it is dirty
- `devclaw-plugin-issue20` because it is dirty and detached
- `devclaw-plugin-issue26` because it is dirty
- `devclaw-plugin-notification-split` because it is dirty and also contains local-only commits

Do **not** delete these without archiving, because they contain commits not present on `origin/main`:

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
- `devclaw-plugin-notification-split`
- `devclaw-plugin-task-manage-comment`
- `devclaw-plugin-validate-clean`

### Safe staged cleanup order

1. Preserve all dirty trees first by either committing, exporting patches, or bundling branches.
2. Delete the low-risk clean/no-unique-history candidates first:
   - `feature/31-workflow-integrity-guardrails`
   - `feature/33-duplicate-issue-detection`
   - `feature/34-pr-reconciliation`
   - `devclaw-plugin-issue28-notify-runtime`
   - `devclaw-plugin-validate-issue20`
3. Archive the clean but unique-history candidates by branch push, `git bundle`, or patch export.
4. Only after archive/merge confirmation, remove the remaining duplicate validation and split repos.
