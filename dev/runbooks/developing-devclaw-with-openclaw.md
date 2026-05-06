# Developing DevClaw with OpenClaw

This runbook is the local-first operator policy for working on DevClaw while DevClaw is your active orchestrator.
It lives under `/dev` because these rules are first-class local operating docs and must be preserved on `devclaw-local-current`.

## Local-first branch policy

Treat these branch roles as the working contract:

- `devclaw-local-dev`: ordinary implementation base branch for normal issue work
- `devclaw-local-current`: local truth, promotion, deploy, and local operational documentation lane
- `devclaw-local-stable`: local fallback lane when `devclaw-local-current` is too noisy or risky
- `issue/*`: local implementation branches for scoped work, normally created from `devclaw-local-dev`
- `review/*`: local review branches opened against `devclaw-local-current`
- `pr/*`: export branches prepared for upstream review

Upstream `main` is a reference point and export target. It is not the normal day-to-day base for local work.

## Operating model

1. Keep local docs and operator runbooks on `devclaw-local-current`.
2. Start ordinary implementation from `devclaw-local-dev` into an `issue/*` branch when you need isolated task work.
3. Use the ordinary implementation PR into `devclaw-local-dev` as the normal developer completion lane.
4. Land validated release-worthy work back onto `devclaw-local-current` through the promotion/review flow so local truth stays complete.
5. When work needs to go upstream, export it onto a matching `pr/*` branch.
6. Preserve the `/dev/` documentation changes on `devclaw-local-current` even when the upstream export omits local-only material.
7. Push runbook and workflow changes to the Git remote that tracks `devclaw-local-current` so the policy is not left only in a local checkout or an unknown branch.

## Mandatory compliance rule

This runbook is required operating procedure, not optional guidance.

Follow it without divergence.
Any divergence from this runbook requires explicit human permission together with an unlock code.
Without that explicit unlock, do not improvise, substitute a different flow, or quietly switch to a different branch or worktree strategy.

If the runbook itself needs to change, update it on `devclaw-local-current` and push that update to the tracked Git remote before relying on the new rule.

## Export policy

Use `review/*` for local-review branches into `devclaw-local-current` and `pr/*` for upstream-facing export branches. Do not use `contrib/*`.

## Local-only regression and documentation boundary

Keep a strong boundary between local operational material and upstream-facing project material.

Local-only material should normally live under `/dev/` on `devclaw-local-current`, especially when it is primarily for local operator use rather than upstream product behavior.

This includes, unless there is a clear reason otherwise:

- local regression notes and local release checklists
- local debug runbooks and local validation recipes
- operator-specific semantic test plans
- local environment identifiers, chat ids, topic ids, or other deployment fingerprints
- fixture wording that exists only to help a local human distinguish one local prompt source from another during live debugging
- temporary or durable notes about self-hosted validation flow that are not part of the upstream product contract

When a regression test or fixture is intended to go upstream, genericize it first.
Do not export local environment fingerprints or local operator-specific semantic markers just because they were convenient during debugging.

For upstream-facing tests and fixtures:

- use clearly fake but shape-valid identifiers
- use neutral marker text instead of local debugging phrases when the exact wording is not part of the product contract
- prefer generic project names and generic prompt content unless a real product-specific example is required

If the local lane needs richer operator-facing regression material than upstream should carry, keep the richer version under `/dev/` and keep the upstream-facing test or fixture intentionally generalized.

Before opening or refreshing a `pr/*` export branch, do an explicit export-hygiene pass for this boundary.
At minimum, check whether the candidate package includes:

- local chat or topic ids
- local-only semantic marker text
- local runbook-only references that should stay under `/dev/`
- prompt or fixture content whose meaning depends on the operator already knowing the local debugging story

If any of those appear in the export package, either move the local-only material under `/dev/` or genericize it before the upstream handoff proceeds.

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

### Promotion ownership and close-gate rule

The orchestrator owns the **promotion lane** end-to-end. Do not treat worker completion as promotion completion.

This section applies to explicit promotion/export work, for example `UP:` issues or tasks that are intentionally preparing `review/*` and `pr/*` branches.
It does **not** mean the orchestrator owns the ordinary implementation PR for normal issue work.
For normal implementation tasks, the developer should still open and maintain the issue PR into the active implementation base branch.

Worker-owned steps may include implementation, review, or testing sub-results such as:

- developer `done`
- reviewer `approve` or `reject`
- tester `pass`, `fail`, or `refine`

Those results are evidence and inputs to the promotion lane. They do **not** by themselves mean the promotion issue is finished.

For local-first release work, the orchestrator-owned responsibilities include:

- keeping the promotion issue current as the canonical lane record
- creating or refreshing the `review/*` branch and local-truth PR
- driving the required human checkpoint on that PR
- ensuring the accepted change actually lands in `devclaw-local-current`
- making the live-install or reload step explicit when the lane requires live validation
- verifying which branch, path, and commit are truly live before claiming the lane is complete
- carrying the lane forward into export prep, handoff, upstream watch, rollback, or cleanup as needed

For any promotion issue, do **not** close or treat it as effectively done until the real terminal checkpoint for that lane has been reached and recorded on the issue.

At minimum, that means the issue should record which of these gates have actually been satisfied:

- the accepted package landed in `devclaw-local-current`
- the required human review, merge, and testing checkpoint occurred
- the live self-hosted environment was reloaded and verified when live validation was part of the lane
- any required export-prep or operator handoff artifacts were prepared
- any remaining human-only next step is explicitly called out if the lane is still open

If one or more of those gates is still pending, the promotion issue is still active even if some worker state labels say `Done`.

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

For local upstream-publication tracking issues, use title format:

- `UP: #<local-issue> <short topic>`

When creating or renaming these local tracking issues from the repo, prefer:

- `dev/scripts/upstream-publication-issue.sh`

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

For local promotion tracking, prefer a title shaped like `UP: #<local-issue> <topic>`.
For those `UP:` issues, the issue itself becomes the authoritative post-review execution checklist. Once human review starts or completes, the agent must be able to continue the remaining export and handoff work directly from the issue body without re-deriving the lane state from memory or from scattered comments.

### `UP:` issue contract

A `UP:` issue must stay current as a durable lane record. At minimum it must carry, in one obvious checklist or status block:

- the current promotion phase
- the local issue being promoted
- the current `review/*` branch name
- the current local-review PR URL and state
- any rollback or demotion PR URL and state if a correction happened
- whether `devclaw-local-current` currently contains the promoted package
- the target `pr/*` export branch name
- whether the `pr/*` branch exists yet
- the compare or diff URL, or an explicit note that it is not ready yet
- the upstream issue linkage status
- whether the final upstream PR title/body is still gated on testing or is now allowed to be written
- any active blocker or human-only next step
- the explicit close gates that remain before the `UP:` issue can be completed

After local review passes, do **not** treat the `UP:` issue as effectively done. The issue remains the active working checklist until the export branch, compare URL, upstream issue linkage, and operator handoff package are actually prepared and recorded.

### `UP:` visible state labels

Use exactly one primary `up:*` label at a time on each active `UP:` issue:

- `up:local-review` for the local `review/*` branch and PR stage
- `up:human-test` while waiting on human or live-environment validation
- `up:rollback` while rollback, demotion, or correction is in progress
- `up:export-prep` while preparing or refreshing the `pr/*` export branch and package
- `up:handoff-ready` when the compare URL, upstream issue linkage, and proposed operator package are ready
- `up:watching-upstream` after the human has opened the upstream PR and the local issue is tracking it
- `up:done` only after the upstream lane is resolved and cleanup is complete

Optional helper labels may be added alongside the one primary label:

- `up:blocked`
- `up:needs-human`

These `up:*` labels are promotion-lane markers. They do **not** replace the normal DevClaw workflow state labels such as `Planning`, `To Do`, `Doing`, `Refining`, or `Done`.

### `UP:` label progression by phase

The owning orchestrator should update the primary `up:*` label immediately when the promotion lane changes phase. Do not leave a stale label behind just because the title or comments imply the newer state.

Use this default progression unless the operator explicitly directs a different release sequence:

1. **`UP:` tracker created, lane not yet in active review or live validation**
   - primary label: none required yet, or `up:needs-human` if the next sequencing decision is waiting on the operator
2. **local `review/*` branch and local-truth PR are the active release vehicle**
   - primary label: `up:local-review`
3. **issue branch or review branch has been moved into the live environment and the lane is paused for operator validation**
   - primary label: `up:human-test`
4. **rollback, demotion, correction, or revalidation after a bad promotion is active**
   - primary label: `up:rollback`
5. **local validation is accepted and the lane is now preparing or refreshing the `pr/*` export branch and package**
   - primary label: `up:export-prep`
6. **compare URL, upstream issue linkage, and pastable operator handoff package are ready**
   - primary label: `up:handoff-ready`
7. **human has opened the upstream PR and the local tracker is now following that upstream lane**
   - primary label: `up:watching-upstream`
8. **upstream lane resolved and local cleanup completed**
   - primary label: `up:done`

If the lane is waiting on a specific human decision, add `up:needs-human` alongside the primary phase label. If the lane cannot proceed because of a concrete blocker, add `up:blocked` alongside the primary phase label and record the blocker clearly in the issue body.

For families that intentionally install an issue branch into the live environment before building the normal local `review/*` package, switch the label to `up:human-test` for that live-validation stop, then move it back into the normal progression once the operator approves continuing the release lane.

### `UP:` close and reopen rules

A `UP:` issue must **not** close merely because local review passed or local testing passed.

It can close only when all of the following are true:

- the final active phase is `up:done`
- the export branch and compare URL have been prepared and recorded, or the issue records why no export is needed
- upstream issue linkage status is recorded
- the operator handoff package is recorded, including any allowed final PR title/body
- any active upstream watch has been resolved or intentionally retired
- release-only cleanup is recorded as complete

If a `UP:` issue was closed too early and must re-enter the lane, first clear terminal workflow state such as `Done` before re-queueing or otherwise resuming active work. Reopening the issue text alone is not enough if terminal workflow labels still block the lane.
## PR handoff policy

The agent should autonomously create or refresh local-truth fork PRs into `devclaw-local-current` whenever the runbook calls for a `review/*` promotion step.

That means the agent should, without waiting for a separate human prompt:

- push the `review/*` branch
- open or refresh the fork PR from `review/*` into `devclaw-local-current`
- record the PR URL and exact branch heads on the owning promotion issue

The agent should **not** open the upstream DevClaw official PR itself.

Instead, as part of the operator handoff, the agent should prepare, in this order:

- after the operator confirms testing is complete, complete the upstream issue linkage step first
- only after the upstream issue exists, prepare and post the compare or diff URL for the `pr/*` branch against upstream `main`
- only after the upstream issue exists, write the proposed PR title
- only after the upstream issue exists, write the proposed PR body as pastable Markdown code

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

Before the operator reports testing complete, the orchestrator should limit the promotion issue handoff to branch heads, PR URLs, and validation evidence. Do not post the compare or diff URL yet, and do not write the final upstream PR title/body yet.

During that stage, the owning `UP:` issue should normally be labeled `up:human-test` or `up:export-prep`, and the issue body should be updated immediately when the lane moves between review, rollback, export prep, handoff-ready, or upstream-watching phases.

After the operator reports testing complete, the orchestrator should:

- inform the operator of the concrete result
- include the relevant PR URLs, merge or success status, and the exact branch or commit that is now considered local truth
- state whether `devclaw-local-current` is now the validated lane to install from
- explicitly offer to install or reload `devclaw-local-current` into the live self-hosted environment
- then complete the upstream issue linkage step
- only after the upstream issue exists, comment on the promotion issue with:
  - the compare or diff URL
  - the final proposed upstream PR title
  - the final pastable upstream PR description as Markdown code

After the operator opens the upstream DevClaw official PR, the orchestrator should keep tracking on the local promotion issue until that upstream PR is resolved.

Immediately after the operator reports that the upstream PR has been opened, the orchestrator should collapse the local release family so the active local surface stays small and obvious.

That immediate post-open cleanup should, unless the operator says otherwise:

- keep the local `UP:` issue open as the canonical tracker
- keep the active `pr/*` export branch that backs the upstream PR
- close any no-longer-needed local fork PRs that were only intermediate release vehicles
- delete no-longer-needed local issue branches, review branches, rollback branches, and worktrees from the same release family
- delete matching remote branches for those no-longer-needed local family artifacts when safe
- record the cleanup on the `UP:` issue so the surviving local release surface is explicit

The goal after upstream PR open is that the local release family should normally collapse to:

- the `UP:` tracking issue
- the retained `pr/*` release branch
- the upstream issue / upstream PR links being watched

That collapse applies to the issue surface too, not only to branches, PRs, and worktrees.
If older local implementation, research, or superseded promotion issues from the same release family are no longer the canonical active tracker, close or otherwise retire them promptly unless there is a concrete reason to keep one open.
Do not leave multiple open local issues representing the same already-promoted family just because the branch/worktree cleanup happened.

Before declaring the family collapsed, do an explicit tracker-surface check:

- list the local issues in that release family
- identify which single issue is the canonical surviving tracker
- close or retire the rest unless the operator explicitly wants them preserved
- record that issue-surface cleanup on the surviving tracker so the local board shape matches the branch/PR cleanup

At that point, the orchestrator should also create or refresh a persistent watch, such as a daily cron job, for that specific upstream PR so it does not get forgotten while waiting on review or merge.

That ongoing tracking should include:

- the upstream PR URL
- significant state changes such as opened, review feedback received, update pushed, approved, merged, or closed
- any linked upstream issue comments or references that matter to the promotion record
- exact export-branch or commit changes if the `pr/*` branch is refreshed
- whether any local-truth or live-install follow-up happened in response to upstream review
- the identity of the active scheduled watch responsible for follow-up

If the promotion enters demotion or rollback flow while a watch exists for that upstream PR, the orchestrator should explicitly review that watch.

Depending on the situation, the orchestrator should:

- remove the watch if the upstream PR is no longer the active release vehicle
- refresh or retarget the watch if the promotion issue or upstream PR has changed
- record that watch change on the local promotion or release-tracking issue

When the upstream PR is fully resolved, the orchestrator should finish the release cleanup on the local side.

That cleanup should include, as applicable:

- closing or otherwise completing the local promotion issue
- deleting no-longer-needed local packaging artifacts and temp directories
- deleting no-longer-needed `pr/*` branches after the upstream resolution is complete
- deleting any other release-only local artifacts that no longer serve an active tracking purpose
- removing the scheduled watch that was tracking the resolved upstream PR

Do not wait until final upstream resolution to collapse obviously redundant local family branches if the upstream PR has already been opened. Once the human reports the upstream PR is open, remove intermediate local family residue promptly unless there is a concrete reason to keep it.

Use a persistent scheduled follow-up, such as a daily cron job, for each active upstream PR watch, and remove that watch when it is no longer needed.

This handoff gives the operator a ready-to-submit upstream PR package while keeping only the final upstream PR opening step under operator control, while also making the live-install follow-up explicit instead of implicit.

## Rollback policy for failed promotions

If a promoted change fails real validation on `devclaw-local-current` or in the live self-hosted environment, treat that promotion as failed and send it back to development.

Do not quietly leave a failed promotion presented as accepted or released.
Do not keep stale release-tracking issues or stale export branches around as if they still represent valid release material.

The required rollback flow is:

1. record the failure on the development issue and on the promotion or release-tracking issue, with concrete evidence from the failed validation
2. update the promotion or release-tracking issue so it clearly records that the old package is no longer a valid release candidate, and move its primary `up:*` label to `up:rollback` while the correction is in progress. Do not close the issue if export or handoff follow-up still remains for the corrected lane
3. move the development issue back into development or refinement as appropriate
4. create a new `review/<issue-number>-<short-description>` rollback branch from `devclaw-local-current`
5. revert the bad merge or bad commit on that rollback branch, rather than silently rewriting history on `devclaw-local-current`
6. push the rollback `review/*` branch and open a fork PR into `devclaw-local-current`
7. merge the rollback PR, then rebuild, reinstall, restart, and verify the live self-hosted environment from the reverted `devclaw-local-current`
8. after the rollback is safely landed and verified, clean up the old failed-release artifacts so they no longer look current or reusable
9. that cleanup should include, as applicable, stale local branches, stale remote branches, stale local PR/export worktrees, stale temp packaging directories tied to the failed promotion family, and any scheduled upstream-PR watch that is no longer valid for the demoted release vehicle
10. if a scheduled watch is still needed because the promotion is being rerun under a new upstream PR or tracking issue, recreate or retarget the watch and record that change on the local promotion or release-tracking issue
11. only after that cleanup, delete or retire the stale `review/*` and `pr/*` release branches that represented the failed promotion
12. only then recreate fresh development, review, and export branches for the corrected fix if the work will continue
13. do not create a replacement `review/*` PR for that same family until step 7 has succeeded, unless the operator explicitly authorizes a different sequencing with an unlock code

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
