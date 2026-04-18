# DevClaw upgrade and patch strategy

This repository uses two layers of customization:

1. **Supported overrides** in workspace-owned DevClaw config and prompt files
2. **Release branches** for changes to DevClaw source code itself

That split keeps upgrades understandable and repeatable.

## Current convention

- Upstream repo: `yaqub0r/devclaw`
- Default branch: `main`
- Custom release branch pattern: `release/devclaw-<identifier>`
- Temporary upgrade branch pattern: `upgrade/devclaw-<target-version>`

Current branch created for local customization tracking:

- `release/devclaw-local-2026-04-12`

## 1) Prefer supported overrides first

If a change can be expressed through DevClaw configuration or prompts, do not patch source.

Typical override locations live outside this source repo, for example:

- `devclaw/workflow.yaml`
- `devclaw/projects/<project>/workflow.yaml`
- `devclaw/prompts/*.md`
- `devclaw/projects/<project>/prompts/*.md`

Those should survive normal DevClaw upgrades.

## 2) Use release branches for source patches

If the change modifies DevClaw product behavior, plugin logic, or implementation details not exposed through config, carry it on a release branch.

Examples:

- bug fixes in source code
- behavior changes in orchestration logic
- plugin implementation changes
- new internal features not represented by existing config

## 3) Branching policy

### Stable branches

- `main` tracks the base integration line
- `release/devclaw-<identifier>` carries validated custom source patches

### Temporary branches

- `upgrade/devclaw-<target-version>` is used while rebasing or cherry-picking custom patches onto a newer upstream base

### Commit style

Prefer small commits with clear intent. Recommended prefixes:

- `patch(devclaw): ...`
- `fix(devclaw): ...`
- `docs(upgrade): ...`
- `chore(branching): ...`

## 4) Upgrade procedure

When upgrading DevClaw to a newer upstream version:

1. Fetch upstream changes.
2. Review the custom commits that must be preserved.
3. Create `upgrade/devclaw-<new-version>` from the new upstream base.
4. Reapply custom commits using cherry-pick or rebase.
5. Resolve conflicts.
6. Test behavior.
7. Create or update `release/devclaw-<new-version>`.
8. Merge the validated release branch as desired.
9. Update this document if the process changes.

### Cherry-pick vs rebase

- Use **cherry-pick** when the patch queue is small and explicit carry-forward is safer.
- Use **rebase** when the branch history is clean and linear.

For a modest local patch set, cherry-pick is usually the simpler default.

## 5) Patch ledger rule

Every source patch that we intend to carry across upgrades should be:

- in a dedicated commit
- described clearly in the commit message
- easy to identify from `git log`

Avoid burying multiple unrelated changes inside one large commit.

## 6) What not to do

Avoid:

- editing installed package files without git history
- mixing source patches with runtime state or scratch files
- relying on memory or chat history alone to reconstruct customizations

## 7) Future operator rule

Before making a change, ask:

- Can this live in workspace config or prompts? If yes, use overrides.
- Does this change DevClaw source behavior? If yes, do it on a release branch.

That is the standing policy for this repository.
