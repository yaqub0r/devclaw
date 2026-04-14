#!/usr/bin/env bash
set -euo pipefail
LINE='*/5 * * * * cd /home/sai/.openclaw/workspace && /usr/bin/python3 /home/sai/.openclaw/workspace/tools/canon_watch.py check >/dev/null 2>&1 # canon-watch'
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v 'canon-watch' > "$TMP" || true
echo "$LINE" >> "$TMP"
crontab "$TMP"
rm -f "$TMP"
echo 'Installed canon-watch system cron.'
