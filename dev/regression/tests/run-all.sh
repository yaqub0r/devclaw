#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
"$root/jsonresult-regression.sh"
"$root/github-repo-routing-95.sh"

echo "All release regression checks passed"
