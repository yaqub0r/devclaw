# DevClaw repo cleanup draft

Status: draft for review, not final runbook yet.

## Goal

Keep the `yaqub0r/devclaw` repository operationally clean so future development stays easy, safe, and understandable.

## Why this exists

DevClaw creates a branch for nearly every issue, but it does not reliably clean up after itself. Over time that leaves:

- stale local branches
- stale remote branches
- stale worktrees
- closed issue lanes that still look active
- abandoned review/export branches
- stray dirty checkouts that confuse later work

This runbook exists to reduce that repo debris.

## Cleanup objectives

A good cleanup should:

- remove branches for closed or superseded issues
- remove stale local worktrees
- remove remote branches that no longer serve a real purpose
- preserve only branches that still matter for current work
- prevent old DevClaw issue lanes from piling up and trampling future work
- leave the repo in a state where the next person can understand what is live, what is historical, and what can be deleted

## Branch-role model

These branch classes exist, but none should survive forever without a reason:

- `devclaw-local-dev` = implementation base
- `devclaw-local-current` = local-truth / release / runbook lane
- `issue/*` = issue-specific implementation branches
- `review/*` = local review branches
- `pr/*` = upstream/export branches
- `ambient/*` or `backup/*` = preserved local state that is intentionally not part of normal active development

The important rule is:

> A branch should exist only if it still has a real operational purpose.

## Default cleanup policy

### Delete by default

Delete a branch/worktree when its purpose is over.

That includes:

- `issue/*` for closed issues
- `issue/*` for superseded issues
- `review/*` whose review is complete or abandoned
- `pr/*` that no longer back a real export/handoff path
- stale local worktrees for finished or abandoned lanes
- old ambient dirty states that have already been preserved elsewhere

### Keep only with a reason

Keep a branch/worktree only if at least one of these is true:

- the issue is still open and active
- there is an open PR depending on it
- it contains unique unmerged work not preserved elsewhere
- it is one of the repo’s canonical long-lived branches
- it is an explicit preservation/archive branch
- the human has said to keep it

## Cleanup procedure

### 1. Freeze new lane churn

Before cleanup:

- no new DevClaw issue branch creation
- no queueing or dispatching new work
- no opportunistic repo edits during the cleanup
- no mixing cleanup with unrelated implementation

### 2. Inventory the repo

Collect:

- all local branches
- all remote branches
- all worktrees
- branch upstream tracking state
- dirty worktrees
- open PRs
- closed PRs
- open issues
- closed issues
- branches with unique local commits
- branches with no clear owner/purpose

### 3. Classify every branch/worktree

Each item should end up in one of these buckets:

- **KEEP**
- **ARCHIVE / RENAME**
- **DELETE LOCAL**
- **DELETE LOCAL + REMOTE**
- **HUMAN DECISION**

No branch should stay unclassified.

### 4. Protect only the truly live branches

The usual protected set is small:

- `devclaw-local-dev`
- `devclaw-local-current`
- any branch backing an open PR
- any branch for an actually open/live issue
- any branch with unique work that has not yet been preserved
- any deliberate `backup/*` or `ambient/*` preservation branch

Everything else should be assumed removable unless proven otherwise.

### 5. Clean closed issue lanes aggressively

For a closed or superseded issue:

- remove its local worktree
- remove its local `issue/*` branch
- remove its remote `issue/*` branch
- remove any paired stale `review/*` branch
- remove any paired stale `pr/*` branch if it no longer serves an active export purpose

This is the core anti-debris rule:

> Closed work should not leave issue branches sitting around locally or remotely.

### 6. Preserve dirty or ambiguous state explicitly

If a checkout is dirty or unclear but should not be lost:

- move it to a clearly named preservation branch like `ambient/*` or `backup/*`
- record why it was preserved
- do not leave it under a misleading active lane name like `issue/*` or `review/*`

### 7. Clean stale worktrees

A worktree should exist only if someone would knowingly use it again.

Delete worktrees that are:

- tied to closed work
- tied to deleted branches
- detached leftovers with no purpose
- stale duplicates of the same lane
- abandoned experimental lanes that have been preserved elsewhere

### 8. Verify after cleanup

After deletion, confirm:

- canonical long-lived branches still exist
- open issues still have the lanes they actually need
- open PRs do not point to deleted branches
- no needed unique commits were lost
- no stale worktrees remain for closed work
- branch list is materially smaller and easier to understand
- the repo now reflects current reality rather than historical clutter

### 9. Record what was removed

For each cleanup pass, log:

- what was deleted
- what was preserved
- what was archived
- what was intentionally kept
- any exceptions and why

## Decision rules

### Delete local and remote branch when:

- issue is closed or superseded
- no open PR uses it
- no unique unpreserved work remains

### Delete local only when:

- local branch/worktree is stale
- remote branch still serves a purpose
- or remote deletion has not yet been approved/verified

### Archive instead of delete when:

- branch is dirty
- branch has unique work
- purpose is unclear
- you want to preserve state before simplifying the repo

### Escalate for human decision when:

- the lane has ambiguous ownership
- issue/PR state conflicts with branch reality
- the branch may still matter but its purpose is undocumented

## Prior cleanup precedent this draft follows

This draft is shaped by the earlier DevClaw cleanup pattern we found:

- fix canonical repo targeting first
- move dirty misleading ambient state onto an explicit preservation branch
- remove stale family branches/worktrees
- keep only branches with a real remaining purpose

But this revised draft is intentionally stricter than the earlier preserve-heavy instinct.

## Open questions for the final runbook

1. Should `pr/*` still be preserved conservatively, or cleaned once their export purpose is done?
2. What should the default root checkout at `/home/sai/git/devclaw` be:
   - clean `main`
   - clean detached HEAD
   - or no operational expectation at all?
3. Should cleanup be allowed to create `backup/*` branches automatically before destructive deletion?
4. Should DevClaw itself be expected to perform this cleanup automatically after issue close / PR merge?
