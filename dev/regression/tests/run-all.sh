#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
"$root/dev-tree-cleanup-105.sh"
"$root/stagegates-projects-parser-223.sh"

echo "All release regression checks passed"
