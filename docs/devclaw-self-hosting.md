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
