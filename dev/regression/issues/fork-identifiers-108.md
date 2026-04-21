# Issue #108: keep local fork identifiers out of generic materials

## Summary

Generic-facing DevClaw code, tests, fixtures, and docs should not embed local fork repo identifiers such as `yaqub0r/devclaw`.
Neutral placeholders should be used unless a real upstream identity is intentionally required.

## Automated coverage

- `lib/regression/fork-identifiers.test.ts`
  - scans repository sources for known local fork identifiers
  - excludes local-only runbooks and regression notes, where environment-specific references may be documented intentionally

## Validation notes

- Searched the repo for `yaqub0r/devclaw`, related owner strings, and common local branch/operator markers
- Confirmed current remaining real repo/package identifiers are upstream/package metadata or publishing context, not local fork fixture data
- Added developer-tree guidance so the rule is documented alongside regression expectations
