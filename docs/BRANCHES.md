# DevClaw Local Branch Model

This repo uses three long-lived local branches:

- `upstream-sync`
  - Tracks upstream-aligned integration state
  - Rebased or refreshed from upstream/main
  - Keep this branch as clean as possible

- `local-stable`
  - Local operational branch
  - The branch intended for tested, deployable local DevClaw behavior
  - Promote changes here only after validation

- `local-development`
  - Local working branch for ongoing development
  - Default branch for new local fixes before promoting to `local-stable`

## Expected flow

1. Refresh `upstream-sync` from upstream/main
2. Port or merge wanted changes into `local-development`
3. Validate locally
4. Promote tested changes into `local-stable`
5. Deploy live DevClaw from `local-stable`

## Notes for agents

- Do not treat the OpenClaw workspace root as the canonical repo checkout.
- Canonical local repo path is expected to be `~/git/devclaw`.
- Live plugin installation should point to a dedicated plugin install or linked source, not the workspace root.
- Prefer short-lived feature branches off `local-development` for scoped work.
