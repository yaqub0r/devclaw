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

## Worktree identity rule

Use a distinguished worktree path that matches the branch or lane you intend to run.

Do not reuse a differently named worktree path for another branch unless a human explicitly approves that exception.

## Safe live-switch procedure

When changing the live DevClaw source during development:

1. Choose the target checkout or worktree.
2. Bootstrap dependencies in that target tree if needed.
3. Build that target source tree.
4. Confirm the built artifact exists.
5. Make sure only one DevClaw plugin source is active.
6. Point OpenClaw at the intended source path.
7. Restart the gateway.
8. Verify the loaded plugin path.
9. Verify the exact live git commit.

## Bootstrap dependencies before building

A fresh worktree may not have its dependencies populated yet. If build tooling is missing, bootstrap the target tree first and only then continue with the build.

For npm-based DevClaw worktrees with a `package-lock.json`, use:

```bash
cd <target-source-root> && npm ci
```

Treat dependency bootstrap as part of the documented live-switch flow, not as an ad hoc recovery step.

## Rebuild dependencies when bootstrap is interrupted or missing

If a prior bootstrap was interrupted, timed out, or left the worktree without `node_modules`, repair that state before building.

Recommended checks:

```bash
cd <target-source-root>
[ -d node_modules ] && echo node_modules-present || echo node_modules-missing
npm ls esbuild --depth=0 || true
```

If dependencies are missing or incomplete, rerun:

```bash
cd <target-source-root> && npm ci
```

Do not treat the worktree as ready until the dependency tree is present and required build tools resolve.

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
- git tells you **what commit that path contains**

## Verify the exact live commit

Once you know the live source path, resolve that path back to the checkout or worktree root and verify the commit directly:

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

## Avoid duplicate plugin-source collisions

A common failure mode is loading DevClaw from more than one place at once, for example:

- an installed copy under `~/.openclaw/extensions/devclaw`
- and a path/worktree load via `plugins.load.paths[]`

If both are in play, the gateway may load a different source than the one you intended.

If startup logs mention duplicate plugin ids or the runtime path does not match your expected worktree, stop and clean up the duplicate before trusting the switch.

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
4. restart and verify again

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
