# Regression note: repo-local developer tree cleanup, issue #105

- Related issue: #105
- Scope: preserve repo-local developer guidance under `dev/` while keeping `dev/` out of the published package payload

## Change summary

This cleanup keeps the self-hosting runbook under `dev/runbooks/`, makes the `/dev` layout and Definition of Done expectations explicit in `dev/README.md`, and preserves the packaging boundary that keeps `dev/` versioned in git but excluded from `package.json.files`.

## Triggering conditions

- documentation or cleanup work moves developer-facing material out of release-user docs
- a packaging change risks shipping the repo-local `dev/` tree in the published package
- follow-up cleanup needs to confirm where regression artifacts and issue-linked notes belong

## Automated coverage

The existing repo checks for this cleanup are:

1. `npm run check`, to confirm the repo still type-checks after the documentation and packaging-boundary cleanup
2. `npm run regression:release`, to confirm the release regression suite still passes with the current `dev/` tree layout

## Manual validation notes

This issue is documentation and packaging-boundary cleanup, so no new executable regression script was added.
Manual validation should confirm that:

- `dev/runbooks/developing-devclaw-with-openclaw.md` still contains the preserved self-hosting sections
- `dev/README.md` explains the intended `/dev` layout and DoD expectations
- `package.json.files` does not include `dev/`
