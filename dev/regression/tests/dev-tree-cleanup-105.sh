#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

python3 - <<'PY'
from pathlib import Path
import json

runbook = Path('dev/runbooks/developing-devclaw-with-openclaw.md').read_text()
readme = Path('dev/README.md').read_text()
pkg = json.loads(Path('package.json').read_text())

for needle in [
    '## Stronger proof for linked local installs',
    '## Generic smoke test for a running environment',
    '## Tracker routing verification for fork-based installs',
]:
    assert needle in runbook, f'missing preserved runbook section: {needle}'

for needle in [
    'Definition of Done',
    'dev/regression/tests/',
    'dev/regression/issues/',
    'The tree should remain in git',
    'exclude `dev/`',
]:
    assert needle in readme, f'missing dev README guidance: {needle}'

files = pkg.get('files', [])
assert 'dev/' not in files and 'dev' not in files, 'package.json.files should exclude dev/'
assert pkg.get('scripts', {}).get('regression:release') == 'bash dev/regression/tests/run-all.sh', 'regression:release script missing or changed'

print('dev tree cleanup regression checks passed')
PY
