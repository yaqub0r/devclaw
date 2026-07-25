#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
node "$root/plugin-tool-contract.mjs"
"$root/dev-tree-cleanup-105.sh"

echo "All release regression checks passed"
