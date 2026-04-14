# DevClaw local branch workflow

This document defines how this local DevClaw fork should be used so workflow work, PRs, and deployment all target the correct integration lane.

## Purpose

The main source of confusion has been treating `main` as if it were always the correct PR target for active work.

In this repository, that is not true for local operational DevClaw work.

This fork carries local/custom DevClaw behavior, and the running environment should use a dedicated local release branch rather than overloading `main`.

## Repository model

This repo now has two intended long-lived fork branches plus one upstream reference line:

1. **Upstream source**
   - `laurentenhoor/devclaw:main`
   - the original upstream project

2. **Fork base / sync line**
   - `yaqub0r/devclaw:main`
   - the clean fork-maintained mirror or reference line for upstream-compatible work

3. **Local release branch**
   - `yaqub0r/devclaw:release/devclaw-local`
   - the local operational line for the running environment
   - the only intended long-lived fork branch besides `main`

## Standing rule

If the running environment is based on the local release branch, then:

- feature branches for operational/local DevClaw work should branch from `release/devclaw-local`
- PRs for operational/local DevClaw work should target `release/devclaw-local`
- the release branch, not `main`, is the live operational lane

## What `main` is for

### Upstream `laurentenhoor/devclaw:main`
Use this as:
- the upstream reference line
- the source for future upgrades, rebases, and cherry-picks
- the place to compare what is custom versus upstream

Do **not** treat upstream `main` as the day-to-day landing branch for local operational fixes.

### Fork `yaqub0r/devclaw:main`
Use this as:
- the fork base branch
- the clean upstream-sync line
- the place to keep work intended to stay close to upstream

Do **not** assume fork `main` is the live operational branch.

## What the local release branch is for

The local release branch is the correct target when:
- the running environment is based on that branch
- local custom patches exist there
- the work is intended to affect the current deployed DevClaw behavior
- PR conflicts are likely if work targets `main` instead

Examples of work that should target the local release branch:
- workflow engine fixes
- local DevClaw orchestration behavior changes
- local patch maintenance
- fixes tied to the currently deployed runtime behavior

## Decision rule before opening a PR

Ask:

1. Is this change meant for the currently running local DevClaw environment?
   - If yes, target `release/devclaw-local`.

2. Is this change intended to be upstream-compatible and not depend on local release-branch patches?
   - If yes, it may be appropriate to target fork `main` first.

3. Is this change intended for the original upstream project?
   - If yes, prepare it separately for `laurentenhoor/devclaw:main` or whatever upstream branch is appropriate.

## Default policy for this repo

Until explicitly changed, the safe default policy is:

- **Base branch for active local DevClaw work:** `release/devclaw-local`
- **PR target for active local DevClaw work:** `release/devclaw-local`
- **Operational deploy branch for local DevClaw work:** `release/devclaw-local`
- **Upstream reference branch:** `upstream/main`
- **Fork sync/reference branch:** `origin/main`

## Local project config note

The worker target branch is also configured in the local DevClaw workspace config at `devclaw/projects.json`.

For the `devclaw` project, the intended values are:

- `baseBranch = release/devclaw-local`
- `deployBranch = release/devclaw-local`

That file is local runtime state in this workspace rather than a tracked source file in the repo, so branch-policy docs must stay aligned with that local config.

## Why this matters

If workers branch from or PR into the wrong branch, several bad things become more likely:
- stale or dirty PRs
- repeated merge conflicts
- duplicate or superseding PRs
- fixes tested against a different base than the running environment
- confusion about what code is actually live

## Operational guidance

### For workflow bugfix work
Unless there is a deliberate exception, assume:
- start from `release/devclaw-local`
- merge back into `release/devclaw-local`
- test against the environment derived from that branch

### For future upgrades
When taking newer upstream DevClaw changes:
- fetch upstream
- update `origin/main` from upstream as desired
- reconstruct or rebase `release/devclaw-local` onto the intended newer base
- validate there
- retire obsolete temporary issue or validation branches when safe
- keep the long-lived fork state limited to `main` and `release/devclaw-local`

## Branch cleanup rule

The intended steady state is:
- `yaqub0r/devclaw:main`
- `yaqub0r/devclaw:release/devclaw-local`

Everything else should be treated as temporary and should eventually be:
- merged,
- closed,
- deleted,
- or archived,

as needed to reach that two-branch outcome safely.

If there is ambiguity, prioritize:
1. preserving recoverability,
2. consolidating into `release/devclaw-local`,
3. eliminating stray long-lived issue and feature branches.

## Related docs

- `docs/upgrade-strategy.md`
- `docs/devclaw-local-upgrade-path.md`
- `docs/local-branch-cleanup-inventory.md`
