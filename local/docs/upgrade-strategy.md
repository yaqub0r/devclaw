# DevClaw upgrade and patch strategy

This repository uses two layers of customization:

1. **Supported overrides** in workspace-owned DevClaw config and prompt files
2. **Source patches** for changes to DevClaw code itself

That split keeps upgrades understandable and repeatable.

## Current local policy

- Upstream repo: `yaqub0r/devclaw`
- Default branch: `main`
- Local-only docs branch: `local/docs`
- Feature/fix branches may be used directly as live runtime sources
- `-stable` is optional as a promotion/fallback lane, not the required install target

## 1) Prefer supported overrides first

If a change can be expressed through DevClaw configuration or prompts, do not patch source.

Typical override locations live outside this source repo, for example:

- `devclaw/workflow.yaml`
- `devclaw/projects/<project>/workflow.yaml`
- `devclaw/prompts/*.md`
- `devclaw/projects/<project>/prompts/*.md`

Those should survive normal DevClaw upgrades.

## 2) Use source branches for source patches

If the change modifies DevClaw product behavior, plugin logic, or implementation details not exposed through config, carry it in git as a normal source patch.

Examples:

- bug fixes in source code
- behavior changes in orchestration logic
- plugin implementation changes
- new internal features not represented by existing config

## 3) Branching policy

### Source branches

- `main` tracks the clean integration line
- `fix/*`, `feature/*`, or other working branches may carry source patches
- any branch may become the live runtime source if we intentionally point OpenClaw at it

### Optional promotion branches

- `devclaw-local-stable` may be used as a validated fallback or promotion lane
- this is a workflow choice, not a technical requirement
- do **not** assume every live install must go through `-stable`

### Docs branch

- `local/docs` is for local-only runbooks and operator documentation
- it is not intended for PRs to `main`

### Commit style

Prefer small commits with clear intent. Recommended prefixes:

- `patch(devclaw): ...`
- `fix(devclaw): ...`
- `docs(local): ...`
- `chore(branching): ...`

## 4) Install procedure for any branch

A branch becomes live when OpenClaw is configured to load the plugin from that branch's checkout or worktree.

What actually controls the live source is the OpenClaw plugin configuration, especially values such as:

- `plugins.installs.devclaw.sourcePath`
- `plugins.load.paths[]`

If those point at a branch worktree, that branch is live.

### Recommended live-switch procedure

1. Check out or create the branch you want to run.
2. Build that branch.
3. Point OpenClaw's DevClaw plugin source/load path at that branch checkout or worktree.
4. Restart the gateway.
5. Verify the live source with:

```bash
openclaw plugins inspect devclaw
openclaw gateway status
```

### Verification rule

Do not assume the installed extension copy at `~/.openclaw/extensions/devclaw/` is the live runtime source.

`openclaw plugins inspect devclaw` is the source of truth.

If it reports a source like `~/git/.../dist/index.js`, that configured source is what the gateway is actually loading.

## 5) Upgrade procedure

When upgrading DevClaw to a newer upstream version:

1. Fetch upstream changes.
2. Review the custom commits that must be preserved.
3. Choose the target branch strategy:
   - patch directly onto a new working branch, or
   - reapply onto an optional promotion branch if we want a validated lane
4. Reapply custom commits using cherry-pick or rebase.
5. Resolve conflicts.
6. Test behavior.
7. Point the live plugin source at the branch we intend to run.
8. Restart gateway and verify the loaded source.
9. Update this document if the process changes.

### Cherry-pick vs rebase

- Use **cherry-pick** when the patch queue is small and explicit carry-forward is safer.
- Use **rebase** when the branch history is clean and linear.

For a modest local patch set, cherry-pick is usually the simpler default.

## 6) Patch ledger rule

Every source patch that we intend to carry across upgrades should be:

- in a dedicated commit
- described clearly in the commit message
- easy to identify from `git log`

Avoid burying multiple unrelated changes inside one large commit.

## 7) What not to do

Avoid:

- editing installed package files without git history
- mixing source patches with runtime state or scratch files
- assuming `-stable` is mandatory for every install
- relying on memory or chat history alone to reconstruct customizations

## 8) Future operator rule

Before making a change, ask:

- Can this live in workspace config or prompts? If yes, use overrides.
- Does this change DevClaw source behavior? If yes, do it in git on a normal source branch.
- Do we want a validated fallback lane? If yes, promote to `-stable` deliberately. If not, install directly from the intended branch.

That is the standing local policy for this repository.
