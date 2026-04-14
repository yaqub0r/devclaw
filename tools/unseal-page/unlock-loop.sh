#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${UNSEAL_STATE_DIR:-/home/sai/.openclaw/workspace/state/unseal}"
STATE_FILE="$STATE_DIR/state.json"
mkdir -p "$STATE_DIR"
while true; do
  if [[ -f "$STATE_FILE" ]] && grep -q '"status": "submitted"' "$STATE_FILE"; then
    python3 /home/sai/.openclaw/workspace/tools/unseal-page/unlock.py || true
  fi
  sleep 2
done
