# Local install and runtime notes

These notes are for the local DevClaw deployment model only. They are not intended for upstream `main`.

## What actually happened on 2026-04-18

We updated the installed extension copy at:
- `~/.openclaw/extensions/devclaw/`

But live OpenClaw was still loading DevClaw from:
- `~/git/devclaw.worktrees/devclaw-local-stable/dist/index.js`

That means updating the installed copy alone did **not** change live behavior.

## Rule: verify live source before claiming a change is deployed

Use these as the source of truth:

```bash
openclaw plugins inspect devclaw
openclaw plugins list
openclaw gateway status
```

Important detail:
- if `openclaw plugins inspect devclaw` reports `Source: ~/git/.../dist/index.js`, that configured source is live
- the installed copy under `~/.openclaw/extensions/devclaw/` may exist and still not be the runtime path that is actually loaded

## Practical deployment checklist for local branches

Before saying a fix is live:

1. check repo HEAD
2. check installed extension HEAD if relevant
3. check `openclaw plugins inspect devclaw`
4. confirm the reported `Source:` path is the one you intended
5. restart gateway if needed
6. verify runtime again after restart

## Current local branch model constraints we learned

- `main` is the clean upstream-sync line, not the place for feature work
- `devclaw-local-stable` is a local release/fallback lane and may be the live runtime source
- if docs or local-only operational notes live on a branch that later promotes into `main`, they will eventually leak unless removed
- local-only runbooks should therefore live on a separate non-promoting branch family or be kept clearly isolated

## Local documentation placement rule

If a note is about:
- local deployment wiring
- local runtime source paths
- local stable/current branch behavior
- operator-only patching process

then it belongs under `local/docs/`, not in public project-facing docs like `README.md`.
