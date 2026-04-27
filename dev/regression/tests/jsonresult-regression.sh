#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

python3 - <<'PY'
from pathlib import Path
import re

helpers = Path("lib/tools/helpers.ts").read_text()
assert "export function jsonResult(payload: unknown)" in helpers, "jsonResult helper missing from lib/tools/helpers.ts"
assert 'JSON.stringify(payload, null, 2)' in helpers, "jsonResult helper no longer pretty-prints payload"
assert 'details: payload' in helpers, "jsonResult helper no longer preserves details payload"

bad_imports = []
for path in Path("lib/tools").rglob("*.ts"):
    text = path.read_text()
    if re.search(r'import\s*\{[^}]*\bjsonResult\b[^}]*\}\s*from\s*["\']openclaw/plugin-sdk["\']', text):
        bad_imports.append(str(path))

assert not bad_imports, "jsonResult still imported from openclaw/plugin-sdk: " + ", ".join(sorted(bad_imports))

expected = [
    Path("lib/tools/tasks/task-create.ts"),
    Path("lib/tools/tasks/research-task.ts"),
    Path("lib/tools/worker/work-finish.ts"),
]
for path in expected:
    text = path.read_text()
    assert "jsonResult" in text, f"{path} should still use jsonResult"
    assert "from \"../helpers.js\"" in text or "from \"../helpers.js\";" in text or "from \"../helpers.js\"\n" in text, f"{path} should import jsonResult from ../helpers.js"

print("jsonResult regression checks passed")
PY
