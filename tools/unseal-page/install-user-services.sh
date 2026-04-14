#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/.config/systemd/user"
cp /home/sai/.openclaw/workspace/tools/unseal-page/openclaw-unseal-page.service "$HOME/.config/systemd/user/"
cp /home/sai/.openclaw/workspace/tools/unseal-page/openclaw-unseal-worker.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now openclaw-unseal-page.service
systemctl --user enable --now openclaw-unseal-worker.service
systemctl --user status --no-pager openclaw-unseal-page.service openclaw-unseal-worker.service
