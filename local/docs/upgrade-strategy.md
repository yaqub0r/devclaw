# Local DevClaw branch and runtime strategy

This document is the **local/operator overlay** for this fork and machine.

For the generic workflow for developing DevClaw while running it through OpenClaw, see:

- [`docs/devclaw-self-hosting.md`](../../docs/devclaw-self-hosting.md)

That repo doc covers the general branch/worktree/live-switch model. This file only records the local policy choices layered on top.

## Repository roles in this environment

- Fork / working repo: `yaqub0r/devclaw`
- Upstream repo: `laurentenhoor/devclaw`
- Clean integration branch: `main`
- Local operator docs branch: `local/docs`
- Local compatibility / carry branch when needed: `main-local`
- Optional validated fallback lanes may exist, for example `devclaw-local-stable`

These names are local conventions, not universal DevClaw requirements.

## Local branching policy

### `main`

Use `main` as the clean integration line for this fork unless there is a deliberate reason to carry a local patch there.

### `local/docs`

Use `local/docs` for local runbooks, operator notes, and fork-specific documentation that is useful here but not intended as an upstream-facing doc lane.

### `main-local`

Use `main-local` as a convenient carry branch when we need to adopt or test a patch on top of `main` before deciding what to merge or promote.

Typical uses:

- pulling in an upstream PR before it lands on `main`
- carrying a small local compatibility patch
- validating a repair before a cleaner upstreamed version is available

### Fallback lanes

A `-stable` style branch is optional. Keep one only if it is actively useful as a fallback or promotion lane.

## Local runtime-switch checklist

When changing the live DevClaw source on this machine:

1. Verify the target worktree is the one you actually want.
2. Build the target worktree.
3. Confirm `dist/index.js` exists there.
4. Check for duplicate DevClaw plugin sources.
5. Point OpenClaw at the intended source path.
6. Restart the gateway.
7. Verify the live plugin path.
8. Verify the exact live commit.

## Local verification commands

Use these as the default verification sequence here:

```bash
openclaw plugins inspect devclaw
openclaw gateway status
git -C <live-source-root> rev-parse HEAD
```

Interpretation:

- `inspect` tells us what source path is live
- `gateway status` confirms the runtime is healthy after restart
- `git rev-parse` confirms the exact live commit

## Local duplicate-source rule

Do not trust a branch switch until duplicate DevClaw plugin sources are ruled out.

The main local failure mode has been mixing:

- a previously installed DevClaw plugin copy
- and a path/worktree-based DevClaw load

If logs mention duplicate plugin ids or the inspected live path is not the path you expected, clean that up before continuing.

## Local policy for patches versus config

Prefer repo source changes only when the behavior change truly belongs in DevClaw itself.

Use workspace config and prompts first when the change can be expressed there.

Examples that belong in git source history:

- runtime compatibility fixes
- behavior changes in plugin logic
- docs that explain repo development workflow

Examples that usually belong outside the source repo:

- project-specific prompts
- local workflow tuning in workspace config
- machine-specific operational state

## Local operator rule

Before switching live or carrying a patch, ask:

- is this a generic DevClaw behavior change
- is this just local policy
- should this live in repo docs, local docs, or workspace config

If it is generic, prefer the repo docs and normal source history.
If it is local, keep it in `local/docs`.
