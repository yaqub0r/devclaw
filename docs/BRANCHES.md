# DevClaw Local Branch Model

This repo now uses this local branch flow:

- `main`
  - Upstream/offical sync lane
  - Keep it as close to official upstream state as possible
  - Refresh it from `origin/main`

- `devclaw-local-stable`
  - Local known-good deployment lane
  - The branch intended for tested, deployable local DevClaw behavior
  - Promote changes here only after validation

- `devclaw-local-current`
  - Local integration lane for active local work
  - New local fixes should generally land here before promotion to stable

- `feature/...`
  - Short-lived issue/task branches
  - Branch from `devclaw-local-current`
  - Merge or cherry-pick back into `devclaw-local-current`

## Expected flow

1. Refresh `main` from `origin/main`
2. Port or merge wanted changes into `devclaw-local-current`
3. Run live/local DevClaw from `devclaw-local-current`
4. Vet changes in real use
5. Promote tested changes into `devclaw-local-stable`

## Deployment policy

- `devclaw-local-current` is the live local runtime lane.
- `devclaw-local-stable` is the known-good fallback and promotion lane.
- Feature/task branches should generally target `devclaw-local-current`, not `devclaw-local-stable`.
- Promote from `devclaw-local-current` to `devclaw-local-stable` only after the live/current lane is vetted.

## Notes for agents

- Do not treat the OpenClaw workspace root as the canonical repo checkout.
- Canonical local repo path is expected to be `~/git/devclaw`.
- Live plugin installation should point to a dedicated plugin install or linked source, not the workspace root.
- Prefer short-lived feature branches off `devclaw-local-current` for scoped work.
- `local-development`, `local-stable`, and older release-style branches should be treated as legacy names unless explicitly needed for migration/history.
