#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

node dev/scripts/parse-stagegates-conversation.mjs \
  --input dev/regression/fixtures/stagegates-projects-conversation.txt \
  --pretty \
  --output "$output_file"

python3 - <<'PY' "$output_file"
from pathlib import Path
import json
import sys

payload = json.loads(Path(sys.argv[1]).read_text())

assert payload['meta']['messageCount'] == 6, payload['meta']
assert any('lookup table' in item for item in payload['highlights']['decisions']), payload['highlights']['decisions']
assert any('destination project slug' in item for item in payload['highlights']['actionItems']), payload['highlights']['actionItems']
assert any('shared project' in item for item in payload['highlights']['openQuestions']), payload['highlights']['openQuestions']
assert any(item['stagegate'] == 'renewal' and item['project'] == 'renewals' for item in payload['highlights']['stagegateProjectMappings']), payload['highlights']['stagegateProjectMappings']
assert any('confuse routing' in item for item in payload['highlights']['risks']), payload['highlights']['risks']

print('stagegates parser regression checks passed')
PY
