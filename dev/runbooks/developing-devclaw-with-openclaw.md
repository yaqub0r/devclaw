# Developing DevClaw with OpenClaw

This runbook is the local-first operator policy for working on DevClaw while DevClaw is your active orchestrator.
It lives under `/dev` because these rules are first-class local operating docs and must be preserved on `devclaw-local-current`.

## Local-first branch policy

Treat these branch roles as the working contract:

- `devclaw-local-current`: local truth and day-to-day working lane
- `devclaw-local-stable`: local fallback lane when `devclaw-local-current` is too noisy or risky
- `issue/*`: local implementation branches for scoped work
- `review/*`: local review branches opened against `devclaw-local-current`
- `pr/*`: export branches prepared for upstream review

Upstream `main` is a reference point and export target. It is not the normal day-to-day base for local work.

## Operating model

1. Keep local docs and operator runbooks on `devclaw-local-current`.
2. Start implementation from `devclaw-local-current` into an `issue/*` branch when you need isolated task work.
3. Land validated work back onto `devclaw-local-current` so local truth stays complete.
4. When work needs to go upstream, export it onto a matching `pr/*` branch.
5. Preserve the `/dev/` documentation changes on `devclaw-local-current` even when the upstream export omits local-only material.
6. Push runbook and workflow changes to the Git remote that tracks `devclaw-local-current` so the policy is not left only in a local checkout or an unknown branch.

## Mandatory compliance rule

This runbook is required operating procedure, not optional guidance.

Follow it without divergence.
Any divergence from this runbook requires explicit human permission together with an unlock code.
Without that explicit unlock, do not improvise, substitute a different flow, or quietly switch to a different branch or worktree strategy.

If the runbook itself needs to change, update it on `devclaw-local-current` and push that update to the tracked Git remote before relying on the new rule.

## Export policy

Use `review/*` for local-review branches into `devclaw-local-current` and `pr/*` for upstream-facing export branches. Do not use `contrib/*`.

The required branch naming conventions are:

- `review/<issue-number>-<short-description>`
- `pr/<issue-number>-<short-description>`

Where:

- `<issue-number>` is the local fix or feature issue being promoted toward DevClaw official
- `<short-description>` is a short stable slug for the promoted change

Typical flow:

1. implement and validate locally
2. open or update the local promotion issue that owns the full upstream-promotion workflow
3. create or refresh `review/<issue-number>-<short-description>` from `devclaw-local-current`
4. apply the exact accepted fix onto the `review/*` branch
5. push the `review/*` branch to the fork remote
6. autonomously open or refresh the fork PR from `review/*` into `devclaw-local-current`
7. use that PR for local-truth review, merge, and testing on `devclaw-local-current`
8. after the change is merged and validated on `devclaw-local-current`, create or refresh `pr/<issue-number>-<short-description>` from `upstream/main`
9. apply the same upstreamable commit set onto the `pr/*` branch
10. push the `pr/*` branch to the fork remote
11. prepare the final compare/diff URL and PR body for DevClaw official

Upstream review material should be prepared from `pr/*`, while `devclaw-local-current` remains the complete local operating branch.

### Fresh-package rule for corrected reruns

If a promotion family has already been merged, failed, gone stale, or otherwise stopped being a clean representation of the current fix, do **not** treat the old merged `review/*` branch or PR as reusable promotion state.

Before creating a fresh review package for the same issue family:

1. determine whether the previous `review/*` package for that family was already merged into `devclaw-local-current`
2. if it was merged and the family is being rerun because the old result was wrong, incomplete, stale, or superseded, create a visible rollback or demotion PR first
3. merge that rollback or demotion back into `devclaw-local-current`
4. verify local truth is now in the intended pre-promotion state
5. only then recreate fresh `review/*` and `pr/*` branches for the corrected fix

Do **not** open or refresh a "new" `review/*` PR for a family whose prior promoted result is still present on `devclaw-local-current`, unless the operator explicitly says the new package should be treated as an additive follow-up rather than a replacement.

In other words: if the old promoted code is what blocks the new review from being meaningful, demote the old code first.

## Traceability rule

When exporting work upstream, keep matching exported commits on `devclaw-local-current`.

That means:

- the code or doc change sent upstream should also exist on `devclaw-local-current`
- if the export needs cleanup, splitting, or local-doc omission, keep a clearly corresponding commit history or note the mapping in the handoff
- do not treat the `pr/*` branch as the only canonical copy of the work

The point of the export is to publish local truth, not replace it.

## Promotion issue requirement

Do not promote code to DevClaw official without a local issue that covers the full promotion from start to finish.

That issue is not just "prep". It owns the entire promotion workflow.

The promotion issue should document:

- the exact local issue or fix being promoted
- the source branch or branches and exact commits
- any prerequisite slices that must go upstream together
- the target `review/<issue-number>-<short-description>` branch name
- the target `pr/<issue-number>-<short-description>` branch name
- the fork PR that will be opened against `devclaw-local-current` for human acceptance and testing
- the compare or diff URL for the later DevClaw official PR
- after the operator reports testing is complete, the proposed title and body for the later DevClaw official PR
- the upstream DevClaw issue link that the later PR should close or reference
- any remaining human-only steps

Use issue `#141` only as a rough shape reference, not as naming guidance. Avoid "start upstream promotion prep" style issue framing. The issue should describe the whole promotion, not just an initial prep stage.

As much non-human work as possible should be completed under that issue before the human review step.

## PR handoff policy

The agent should autonomously create or refresh local-truth fork PRs into `devclaw-local-current` whenever the runbook calls for a `review/*` promotion step.

That means the agent should, without waiting for a separate human prompt:

- push the `review/*` branch
- open or refresh the fork PR from `review/*` into `devclaw-local-current`
- record the PR URL and exact branch heads on the owning promotion issue

The agent should **not** open the upstream DevClaw official PR itself.

Instead, as part of the operator handoff, the agent should prepare:

- the compare or diff URL for the `pr/*` branch against upstream `main`
- after the operator confirms testing is complete, the proposed PR title
- after the operator confirms testing is complete, the proposed PR body

Before writing that final upstream PR title/body into the promotion issue, the orchestrator should:

- check whether the fix already corresponds to an existing issue on `laurentenhoor/devclaw`
- if an existing upstream issue exists, reference it in the proposed PR body and add or refresh an issue comment when the fix handoff should be visible there
- if no upstream issue exists, open a new issue on `laurentenhoor/devclaw` that describes the problem as a discrete standalone record, without assuming the reader already knows the history
- after opening that new issue, add a follow-up issue comment pointing to the prepared fix branch or compare URL when appropriate
- include the resulting upstream issue link in the proposed PR body

So the rule is:

- `review/*` PRs into `devclaw-local-current` should be done autonomously
- upstream official PR opening remains human-controlled

After the relevant PR steps have succeeded, the orchestrator should not stop silently at "package prepared" or "PR merged".

Before the operator reports testing complete, the orchestrator should limit the promotion issue handoff to branch heads, PR URLs, validation evidence, and the compare URL. Do not write the final upstream PR title/body yet.

After the operator reports testing complete, the orchestrator should:

- inform the operator of the concrete result
- include the relevant PR URLs, merge or success status, and the exact branch or commit that is now considered local truth
- state whether `devclaw-local-current` is now the validated lane to install from
- explicitly offer to install or reload `devclaw-local-current` into the live self-hosted environment
- then complete the upstream issue linkage step and write the final proposed upstream PR title/body into the promotion issue

After the operator opens the upstream DevClaw official PR, the orchestrator should keep tracking on the local promotion issue until that upstream PR is resolved.

That ongoing tracking should include:

- the upstream PR URL
- significant state changes such as opened, review feedback received, update pushed, approved, merged, or closed
- any linked upstream issue comments or references that matter to the promotion record
- exact export-branch or commit changes if the `pr/*` branch is refreshed
- whether any local-truth or live-install follow-up happened in response to upstream review

When the upstream PR is fully resolved, the orchestrator should finish the release cleanup on the local side.

That cleanup should include, as applicable:

- closing or otherwise completing the local promotion issue
- deleting no-longer-needed local packaging artifacts and temp directories
- deleting no-longer-needed `pr/*` branches after the upstream resolution is complete
- deleting any other release-only local artifacts that no longer serve an active tracking purpose

Use a persistent scheduled follow-up, such as a daily cron job, so opened upstream PRs do not get forgotten while waiting on review or merge.

This handoff gives the operator a ready-to-submit upstream PR package while keeping only the final upstream PR opening step under operator control, while also making the live-install follow-up explicit instead of implicit.

## Rollback policy for failed promotions

If a promoted change fails real validation on `devclaw-local-current` or in the live self-hosted environment, treat that promotion as failed and send it back to development.

Do not quietly leave a failed promotion presented as accepted or released.
Do not keep stale release-tracking issues or stale export branches around as if they still represent valid release material.

The required rollback flow is:

1. record the failure on the development issue and on the promotion or release-tracking issue, with concrete evidence from the failed validation
2. update or close the promotion or release-tracking issue so it no longer represents an active valid release
3. move the development issue back into development or refinement as appropriate
4. create a new `review/<issue-number>-<short-description>` rollback branch from `devclaw-local-current`
5. revert the bad merge or bad commit on that rollback branch, rather than silently rewriting history on `devclaw-local-current`
6. push the rollback `review/*` branch and open a fork PR into `devclaw-local-current`
7. merge the rollback PR, then rebuild, reinstall, restart, and verify the live self-hosted environment from the reverted `devclaw-local-current`
8. after the rollback is safely landed and verified, clean up the old failed-release artifacts so they no longer look current or reusable
9. that cleanup should include, as applicable, stale local branches, stale remote branches, stale local PR/export worktrees, and stale temp packaging directories tied to the failed promotion family
10. only after that cleanup, delete or retire the stale `review/*` and `pr/*` release branches that represented the failed promotion
11. only then recreate fresh development, review, and export branches for the corrected fix if the work will continue
12. do not create a replacement `review/*` PR for that same family until step 7 has succeeded, unless the operator explicitly authorizes a different sequencing with an unlock code

Normal rollback should be done as a visible revert PR into `devclaw-local-current`.
Do not force-reset, force-push, or rewrite local-truth history unless the operator explicitly authorizes that divergence with an unlock code.

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
