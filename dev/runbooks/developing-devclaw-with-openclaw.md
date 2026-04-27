# Developing DevClaw with OpenClaw

This runbook is the local-first operator policy for working on DevClaw while DevClaw is your active orchestrator.
It lives under `/dev` because these rules are first-class local operating docs and must be preserved on `devclaw-local-current`.

## Local-first branch policy

Treat these branch roles as the working contract:

- `devclaw-local-current`: local truth and day-to-day working lane
- `devclaw-local-stable`: local fallback lane when `devclaw-local-current` is too noisy or risky
- `issue/*`: local implementation branches for scoped work
- `pr/*`: export branches prepared for upstream review

Upstream `main` is a reference point and export target. It is not the normal day-to-day base for local work.

## Operating model

1. Keep local docs and operator runbooks on `devclaw-local-current`.
2. Start implementation from `devclaw-local-current` into an `issue/*` branch when you need isolated task work.
3. Land validated work back onto `devclaw-local-current` so local truth stays complete.
4. When work needs to go upstream, export it onto a matching `pr/*` branch.
5. Preserve the `/dev/` documentation changes on `devclaw-local-current` even when the upstream export omits local-only material.

## Export policy

Use `pr/*` for upstream-facing export branches, not `contrib/*`.

Typical flow:

1. implement and validate locally
2. land the accepted result on `devclaw-local-current`
3. create or refresh the corresponding `pr/*` branch for upstream review
4. push the `pr/*` branch to the fork remote

Upstream review material should be prepared from `pr/*`, while `devclaw-local-current` remains the complete local operating branch.

## Traceability rule

When exporting work upstream, keep matching exported commits on `devclaw-local-current`.

That means:

- the code or doc change sent upstream should also exist on `devclaw-local-current`
- if the export needs cleanup, splitting, or local-doc omission, keep a clearly corresponding commit history or note the mapping in the handoff
- do not treat the `pr/*` branch as the only canonical copy of the work

The point of the export is to publish local truth, not replace it.

## PR handoff policy

The agent should not open the upstream PR itself.

Instead, as part of the operator handoff, the agent should prepare:

- the compare or diff URL for the `pr/*` branch against upstream `main`
- the proposed PR title
- the proposed PR body

This handoff gives the operator a ready-to-submit upstream PR package while keeping the actual PR opening step under operator control.

## Live-source safety checks

A branch does not become live because you checked it out.
A branch becomes live when OpenClaw is loading the DevClaw plugin from that checkout or worktree.

Before trusting a branch switch:

```bash
openclaw plugins inspect devclaw
openclaw gateway status
git -C <live-source-root> rev-parse --abbrev-ref HEAD
git -C <live-source-root> rev-parse HEAD
```

Use these checks to confirm:

- which path is actually live
- which branch that path is on
- which exact commit is running

## Self-hosted install rule

This runbook is mandatory for live self-hosted DevClaw installs and reloads. It is not optional guidance.

When the task is to install or reload DevClaw into the live self-hosted environment, use the self-hosting document as the install procedure source of truth and follow it strictly, step by step.

Do not improvise the install from memory.
Do not substitute an isolated validation worktree for a real live self-hosted install when the task explicitly calls for live-environment validation.
Do not branch into an ad hoc debug flow just because the install hits friction.

If a change is prepared on `pr/*`, merge or carry that validated change back onto `devclaw-local-current` before treating it as the normal live operating branch.

When friction appears, continue with the next documented runbook step.
If the runbook says to clean up a collision, clean up the collision.
If the runbook says to restart and verify again, restart and verify again.

If the self-hosting document is missing, stale, or does not cover a required live-install step, stop and fix the documentation gap before proceeding.
Do not invent a replacement procedure while the documentation gap is still open.

## Build before switching live

```bash
test -f <target-source-root>/dist/index.js && echo built || echo missing-dist
```

If `dist/index.js` is missing, build first and do not switch the live source yet.

## Duplicate-source warning

Do not trust a switch if DevClaw may be loading from more than one source, for example:

- `~/.openclaw/extensions/devclaw`
- a path or worktree entry in `plugins.load.paths[]`

If the runtime path is wrong or duplicate plugin ids appear in logs, clean that up before continuing.
