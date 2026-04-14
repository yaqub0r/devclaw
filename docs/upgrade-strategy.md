# DevClaw upgrade and patch strategy

This repository uses two layers of customization:

1. **Supported overrides** in workspace-owned DevClaw config and prompt files
2. **Release branches** for changes to DevClaw source code itself

That split keeps upgrades understandable and repeatable.

## Current convention

- Upstream source repo: `laurentenhoor/devclaw`
- Fork repo: `yaqub0r/devclaw`
- Fork base branch: `main`
- Local operational branch: `release/devclaw-local`
- Temporary upgrade branch pattern: `upgrade/devclaw-<target-version>`

The dated branch `release/devclaw-local-2026-04-12` should be treated as the prior release snapshot that is being consolidated into `release/devclaw-local`.

## 1) Prefer supported overrides first

If a change can be expressed through DevClaw configuration or prompts, do not patch source.

Typical override locations live outside this source repo, for example:

- `devclaw/workflow.yaml`
- `devclaw/projects/<project>/workflow.yaml`
- `devclaw/prompts/*.md`
- `devclaw/projects/<project>/prompts/*.md`

Those should survive normal DevClaw upgrades.

## 2) Use the release branch for source patches

If the change modifies DevClaw product behavior, plugin logic, or implementation details not exposed through config, carry it on `release/devclaw-local`.

Examples:

- bug fixes in source code
- behavior changes in orchestration logic
- plugin implementation changes
- new internal features not represented by existing config

## 3) Branching policy

### Stable branches

- `main` tracks the fork base and upstream-sync line
- `release/devclaw-local` carries validated local custom source patches

### Temporary branches

- `feature/<issue>-<slug>` for issue work
- `upgrade/devclaw-<target-version>` while rebasing or cherry-picking custom patches onto a newer base
- ad hoc validation branches only when necessary, and they should be retired after use

### Commit style

Prefer small commits with clear intent. Recommended prefixes:

- `patch(devclaw): ...`
- `fix(devclaw): ...`
- `docs(upgrade): ...`
- `chore(branching): ...`

## 4) Upgrade procedure

When upgrading DevClaw to a newer upstream version:

1. Fetch upstream changes.
2. Update or review the fork base line on `main`.
3. Review the custom commits that must be preserved on `release/devclaw-local`.
4. Create `upgrade/devclaw-<new-version>` from the desired newer base.
5. Reapply custom commits using cherry-pick or rebase.
6. Resolve conflicts.
7. Test behavior.
8. Fast-forward or rebuild `release/devclaw-local` from the validated result.
9. Retire obsolete dated release or validation branches after confirming recoverability.
10. Update this document if the process changes.

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
- treating temporary feature or validation branches as quasi-permanent integration lanes

## 7) Future operator rule

Before making a change, ask:

- Can this live in workspace config or prompts? If yes, use overrides.
- Does this change DevClaw source behavior? If yes, do it on `release/devclaw-local`.
- Is this meant to stay upstream-compatible? If yes, keep `main` clean and isolate the local patch on the release branch.

That is the standing policy for this repository.
