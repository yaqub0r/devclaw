#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  *Username*) printf '%s\n' "fujiwaranosai850" ;;
  *Password*) python3 /home/sai/.openclaw/workspace/tools/unseal-page/print_github_pat.py ;;
  *) printf '\n' ;;
esac
