# Regression note: GitHub repo routing, issue #95 family

- Related issues: #95 family on the local stable line
- Scope: tracker operations must target the configured GitHub repo, not whichever repo the local checkout happens to be in

## Bug summary

When DevClaw operated from a local checkout with explicit project tracker routing, some GitHub issue operations risked falling back to ambient repo context instead of the configured tracker target.

## Triggering conditions

- project config includes `repoRemote`
- DevClaw uses GitHub provider operations for issue reads, transitions, labels, or comments
- local checkout repo differs from the intended tracker repo, or ambient gh repo context is wrong

## Automated coverage

`dev/regression/tests/github-repo-routing-95.sh` verifies that:

1. `resolveProvider()` derives an explicit provider target from `project.repoRemote`
2. `normalizeRepoTarget()` still handles SSH, HTTPS, and plain owner/repo forms
3. `GitHubProvider` continues to append `--repo` for issue, PR, label, and REST API calls when a target repo is configured
4. the focused TypeScript regression suite `lib/providers/provider-targeting.test.ts` remains present

## Manual validation notes

For a live check, use a project whose working tree repo and issue tracker repo differ, then confirm issue create/read/comment flows hit the configured tracker repo rather than the local checkout repo.
