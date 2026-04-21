# DevClaw developer tree

This `dev/` tree is the canonical in-repo home for developer-only material.
It is versioned with the repository so developer guidance and regression artifacts travel with the codebase, but it is not intended to be part of the end-user release payload.
The tree should remain in git, while `package.json.files` should continue to exclude `dev/` so these artifacts are not shipped by default.

## Required layout

The intended top-level artifact layout under `/dev` is:

- `dev/README.md`, the top-level guide to the developer-only tree
- `dev/runbooks/`, for developer and operator runbooks, including self-hosting guidance
- `dev/regression/tests/`, for executable regression coverage
- `dev/regression/issues/`, for issue-linked notes, bug summaries, and validation rationale
- `dev/regression/fixtures/`, or equivalent supporting fixture/helper material when tests need stable inputs

At minimum, the developer tree should contain:

- `dev/README.md`, the top-level guide to the developer-only tree
- `dev/runbooks/`, for developer and operator runbooks
- self-hosting documentation under `dev/runbooks/`
- `dev/regression/tests/`, for executable regression coverage
- `dev/regression/issues/`, for issue-linked notes, bug summaries, and validation rationale
- `dev/regression/fixtures/`, or equivalent supporting fixture/helper material when tests need stable inputs

Release-user documentation stays under `docs/`.
Developer-only runbooks, issue-linked regression notes, and release-hardening checks belong under `dev/`.

## Neutral identifiers in generic materials

Generic-facing code, tests, fixtures, and docs should use neutral placeholders such as `example-owner/example-repo` or `octo-org/octo-repo`.
Do not hardcode fork-specific or operator-specific repo identifiers in generic materials.

Local fork, branch, host, or operator details may appear only where they are operationally required for local-only runbooks or config.
If a real upstream repo or package identity is intentionally required, keep it narrowly scoped and make the reason obvious from context.

## Definition of Done for release-relevant fixes

Do not consider an issue done until the regression story is addressed.
Issues are not considered done until regression tests are added when appropriate, along with any supporting rationale or fixtures under `/dev`.

When a bug fix is release-relevant or likely to regress, the issue is not done until the regression story is addressed:

1. add or update executable regression coverage under `dev/regression/tests/`
2. document the bug summary, triggering conditions, automated coverage, and any manual validation notes under `dev/regression/issues/`
3. add fixtures or helpers under `dev/regression/fixtures/` when the regression needs stable inputs

If a fix does not need a regression artifact, the developer handling the issue should be able to explain why.
