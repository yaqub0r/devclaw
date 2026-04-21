#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

python3 - <<'PY'
from pathlib import Path

helpers = Path("lib/tools/helpers.ts").read_text()
github = Path("lib/providers/github.ts").read_text()
provider_test = Path("lib/providers/provider-targeting.test.ts")

assert "project.repoRemote ? { repo: normalizeRepoTarget(project.repoRemote) } : undefined" in helpers, "resolveProvider no longer derives explicit target repo from project.repoRemote"
for needle in [
    'trimmed.match(/github\\.com[:/]([^/]+\\/[^/.]+)(?:\\.git)?$/i)',
    'trimmed.match(/gitlab\\.com[:/]([^/]+\\/[^/.]+)(?:\\.git)?$/i)',
    'const url = new URL(trimmed)',
    'return trimmed.replace(/\\.git$/i, "")',
]:
    assert needle in helpers, f"normalizeRepoTarget coverage snippet missing: {needle}"

for needle in [
    'return [...args, "--repo", this.targetRepo];',
    'if (args[0] === "issue") return true;',
    'if (args[0] === "pr") return true;',
    'if (args[0] === "label") return true;',
    'if (args[0] !== "api") return false;',
    'if (this.targetRepo) {',
    'const [owner, name] = this.targetRepo.split("/");',
]:
    assert needle in github, f"GitHub provider routing guard missing: {needle}"

assert provider_test.exists(), "provider-targeting regression suite is missing"
text = provider_test.read_text()
for needle in [
    'passes --repo for issue creation when target repo is configured',
    'passes --repo for issue read, edit, label, and comment paths when target repo is configured',
    'uses configured target repo for repo info without gh repo view',
]:
    assert needle in text, f"provider-targeting test no longer covers: {needle}"

print("GitHub repo routing regression checks passed")
PY
