#!/usr/bin/env bash
set -euo pipefail
SECRET_FILE="${UNSEAL_SECRET_FILE:-/home/sai/.openclaw/workspace/state/unseal/boot-secret.txt}"
exec cat "$SECRET_FILE"
