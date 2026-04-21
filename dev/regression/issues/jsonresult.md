# Regression note: jsonResult helper contract

- Related issue: plugin-sdk `jsonResult` removal on the release line
- Scope: tool response formatting for DevClaw admin, task, and worker tools

## Bug summary

`openclaw/plugin-sdk` stopped exporting `jsonResult`, but multiple DevClaw tools still imported it directly. That broke type-checking and test/module loading before tool code could run.

## Triggering conditions

- OpenClaw/plugin-sdk version without a `jsonResult` export
- Any DevClaw tool module importing `jsonResult` from the plugin SDK instead of repo-local helpers

## Automated coverage

`dev/regression/tests/jsonresult-regression.sh` verifies that:

1. `lib/tools/helpers.ts` defines the repo-local `jsonResult` wrapper
2. no file under `lib/tools/` imports `jsonResult` from `openclaw/plugin-sdk`
3. representative tool modules import `jsonResult` from `../helpers.js`

## Manual validation notes

If you need runtime confirmation, run the stable-line test or build command after dependency install and confirm tool modules load without `jsonResult` import errors.
