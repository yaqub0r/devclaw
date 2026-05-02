# Developing DevClaw with OpenClaw

This guide covers the generic workflow for developing DevClaw while running DevClaw through OpenClaw.

It is intentionally environment-agnostic. If your machine or fork has local policy, branch names, or operator habits layered on top, keep those in local-only docs and link back here.

## What this guide is for

Use this when you are:

- editing DevClaw source while DevClaw is your active orchestrator
- switching the live plugin source between branches or worktrees
- validating that a branch change actually became the runtime source
- avoiding duplicate plugin-source loads during local development

## Core idea

A branch does not become live because you checked it out.

A branch becomes live when OpenClaw is loading the DevClaw plugin from that checkout or worktree.

That means branch switching for DevClaw development is really a **plugin source switch** followed by a **runtime verification** step.

## Recommended branch roles

These are roles, not mandatory branch names:

- **clean integration branch**: the branch that tracks the normal upstream line
- **working branch**: a feature or fix branch carrying in-progress changes
- **fallback branch**: an optional known-good branch you can switch back to quickly
- **local docs branch**: an optional branch for operator runbooks that are not meant for upstream

Use names that fit your repo. The workflow matters more than the naming.

## Safe live-switch procedure

When changing the live DevClaw source during development:

1. Choose the target checkout or worktree.
2. Build that target source tree.
3. Confirm the built artifact exists.
4. Make sure only one DevClaw plugin source is active.
5. Point OpenClaw at the intended source path.
6. Restart the gateway.
7. Verify the loaded plugin path.
8. Verify the exact live git commit.

## Single-source rule

For routine self-hosted DevClaw development, treat **one active local plugin source** as the rule.

Do not leave DevClaw simultaneously discoverable from multiple local sources unless you are intentionally debugging loader behavior.

In practice, that means you should pick one of these models and keep the others out of the live path:

- **linked path install from the intended checkout or worktree**
- **copied install under `~/.openclaw/extensions/devclaw`**
- **explicit `plugins.load.paths[]` source path**

Unsafe or confusing combinations include:

- a copied install plus an active `plugins.load.paths[]` entry for DevClaw
- more than one DevClaw worktree listed in `plugins.load.paths[]`
- `plugins.load.paths[]` still pointing at a worktree you plan to delete

If you are not intentionally testing plugin loading behavior, reduce the setup to one clear live source before trusting any runtime result.

## Build before switching

Before switching live, verify the target source tree has a built artifact:

```bash
test -f <target-source-root>/dist/index.js && echo built || echo missing-dist
```

If `dist/index.js` is missing, build first and do not switch the live source yet.

## Verify the live source path

The source of truth is the live plugin inspection output, not memory and not the checkout you happen to be editing.

```bash
openclaw plugins inspect devclaw
openclaw gateway status
```

Use `openclaw plugins inspect devclaw` to answer:

- what path is actually live
- which plugin version is loaded

Important distinction:

- `inspect` tells you **what path is live**
- runtime provenance tells you **what embedded build is live**
- git tells you **what commit a still-present source tree contains**

## Verify the exact live build without the repo

Use the embedded provenance first. It survives even if the linked source worktree is gone:

```bash
openclaw agent --agent <agent-id> --message 'Call config with action "provenance" and reply with the result only.' --json
openclaw devclaw provenance
```

This reports the live package version, commit SHA, short SHA, branch, dirty flag, and build timestamp from the built artifact itself.

## Verify the exact live commit from source path inspection

If the source tree still exists, you can also resolve the live source path back to the checkout or worktree root and verify the commit directly:

```bash
openclaw plugins inspect devclaw
git -C <live-source-root> rev-parse HEAD
```

Do not assume that the installed extension directory or your current shell checkout is the live commit.

## Stronger proof for linked local installs

If you are using a linked local install and want stronger proof that the live plugin really comes from the intended worktree, verify both the install path target and the branch name:

```bash
openclaw plugins inspect devclaw
readlink -f ~/.openclaw/extensions/devclaw
git -C <intended-worktree> rev-parse --abbrev-ref HEAD
git -C <intended-worktree> rev-parse HEAD
```

This gives you four checks:

- the live plugin id and loaded source
- the real filesystem target behind the installed extension path
- the branch name of the intended worktree
- the exact commit of that worktree

For example, if you intend to run from a `devclaw-local-stable` worktree, these checks should agree on both the path and the branch identity before you treat the switch as complete.

## Copied install versus linked install

This distinction matters a lot during self-hosting.

A local path install can exist in two very different states:

- a **copied install**, where `~/.openclaw/extensions/devclaw` contains a copy of the plugin files
- a **linked install**, where `~/.openclaw/extensions/devclaw` points back to your intended checkout or worktree

If you only rebuild the source worktree, a copied install will keep running the old copied artifact. In that case, `openclaw plugins inspect devclaw` may still show the recorded source path you originally installed from, even though the live loaded code is coming from the copied install directory.

That means:

- rebuilding a worktree is **not** enough by itself to switch a copied install
- restart alone is **not** enough if the installed files were copied earlier
- for live branch or worktree development, you usually want a **linked** install

Useful checks:

```bash
openclaw plugins inspect devclaw
readlink -f ~/.openclaw/extensions/devclaw
```

Interpretation:

- if the install path resolves to your intended worktree, you are running a linked install
- if the install path stays under `~/.openclaw/extensions/devclaw`, treat it as a copied install until proven otherwise

To refresh the live environment from a worktree after a copied install, reinstall the plugin from that worktree as a linked install, then restart the gateway and verify again.

## Avoid duplicate plugin-source collisions

A common failure mode is loading DevClaw from more than one place at once, for example:

- an installed copy under `~/.openclaw/extensions/devclaw`
- and a path/worktree load via `plugins.load.paths[]`

If both are in play, the gateway may load a different source than the one you intended.

If startup logs mention duplicate plugin ids or the runtime path does not match your expected worktree, stop and clean up the duplicate before trusting the switch.

### Pre-delete rule for worktrees

Before deleting any DevClaw worktree that has ever been used as a live source, first remove or update any matching references in live OpenClaw config.

Check at least:

- `plugins.load.paths[]`
- any recorded install metadata that still points at that worktree
- any local notes or scripts that still treat that worktree as the live source

Do not delete the worktree first and plan to clean config up later. That leaves you with exactly the stale-path failure mode where plugin inspection and gateway status become harder to trust.

### Recovery when config points at a deleted worktree

If `openclaw plugins inspect devclaw` or `openclaw gateway status` fails because config still points at a deleted worktree:

1. open `~/.openclaw/openclaw.json`
2. inspect `plugins.load.paths[]`
3. remove the deleted worktree path or replace it with the intended live source
4. inspect any recorded DevClaw install metadata and update it if it still points at the deleted worktree
5. restart the gateway
6. rerun:
   - `openclaw gateway status`
   - `openclaw plugins inspect devclaw`
   - embedded provenance check
7. only after those checks agree again, trust any branch, path, or commit conclusion

## When a live switch failed

Treat the switch as failed if any of the following happen:

- `openclaw plugins inspect devclaw` reports the wrong source path
- the plugin is missing after restart
- startup logs show duplicate plugin warnings
- the target source tree has no `dist/index.js`
- the gateway is still loading an older installed copy

In that case:

1. verify the target build artifact exists
2. inspect the live plugin path again
3. remove or disable competing DevClaw plugin sources
4. if config references a deleted worktree, fix `plugins.load.paths[]` before continuing
5. restart and verify again

## Generic smoke test for a running environment

Use this when you want to verify a local DevClaw install in an already-running environment without creating new projects or tasks.

## Tracker routing verification for fork-based installs

If your local checkout has both a fork and an upstream remote, do not trust ambient GitHub CLI repo inference.

Before relying on issue-creation flows, verify both the configured tracker target and the checkout's ambient `gh` target:

```bash
python3 - <<'PY'
import json
p=json.load(open('devclaw/projects.json'))['projects']['devclaw']
print(p['repoRemote'])
PY
git -C <repo-or-worktree> remote -v
gh repo view --json nameWithOwner --jq .nameWithOwner
```

Expected safety rule:

- DevClaw issue/task tooling must route to the repository configured in `projects.json`
- it must not drift to the repo that `gh` happens to infer from the checkout context

When validating a fix for tracker-routing bugs, record both:

- a pre-change proof showing config target versus ambient `gh` target
- a post-change proof showing issue/task creation calls explicitly target the configured repo

Read-only checks:

```bash
openclaw plugins inspect devclaw
openclaw plugins list
openclaw gateway status
openclaw agent --agent <agent-id> --message 'Call project_status with channelId "<channel-id>" and reply with the result only.' --json
openclaw agent --agent <agent-id> --message 'Call tasks_status and reply with the result only.' --json
openclaw agent --agent <agent-id> --message 'Call channel_list and reply with the result only.' --json
```

What this verifies:

- the plugin is loaded
- the gateway is healthy
- the live agent can read local project state
- the live agent can read tracker-backed task state
- channel bindings are visible

Expected result note:

- in an unbound DM or admin session, `project_status` and `tasks_status` may correctly return `No project found` for that channel
- treat that as a passing result for this smoke test unless you were specifically testing a known project-bound chat

Avoid using project-creating or task-creating commands for smoke tests in a shared live environment unless you also have an explicit cleanup plan.

## Keep generic guidance separate from local policy

Generic repo docs should cover:

- the branch/worktree switching model
- build and verification steps
- duplicate-source failure modes
- how to reason about live source versus checked-out source

Local-only docs should cover:

- branch names used on one machine or fork
- preferred fallback lanes
- machine-specific paths
- personal or operator-specific workflow habits

That separation keeps the main docs useful in any environment while still allowing strong local runbooks.
