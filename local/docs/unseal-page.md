# Unseal Page

## Purpose

Provides a temporary password entry page for boot-time secret unlock without requiring shell login.

## Current behavior

- Binds to `http://192.168.32.254:18888`
- Shows a fresh 5-emoji challenge
- Challenge is echoed in chat for manual verification
- Accepts a one-time token plus password submission
- Writes the submitted password to `state/unseal/boot-secret.txt`
- Worker watches for submitted secrets and runs `lpass login --trust`
- On success, page state becomes `unsealed`
- Page exits about 15 seconds after successful unseal

## Files

- `tools/unseal-page/server.js` - page server and challenge/token flow
- `tools/unseal-page/unseal.html` - page UI
- `tools/unseal-page/unlock.py` - unlock worker logic
- `tools/unseal-page/unlock-loop.sh` - simple worker loop
- `tools/unseal-page/askpass.sh` - askpass helper for `lpass`
- `tools/unseal-page/openclaw-unseal-page.service` - user systemd service for page
- `tools/unseal-page/openclaw-unseal-worker.service` - user systemd service for worker

## Service management

Installed as user services:

- `openclaw-unseal-page.service`
- `openclaw-unseal-worker.service`

Useful commands:

```bash
systemctl --user status openclaw-unseal-page.service
systemctl --user status openclaw-unseal-worker.service
systemctl --user restart openclaw-unseal-page.service
systemctl --user restart openclaw-unseal-worker.service
journalctl --user -u openclaw-unseal-page.service -n 50 --no-pager
journalctl --user -u openclaw-unseal-worker.service -n 50 --no-pager
```

## State files

Under `state/unseal/`:

- `state.json` - current page state
- `result.json` - last unlock result
- `boot-secret.txt` - transient submitted secret, deleted after worker use

## Known limits

- Current transport is HTTP on LAN, not HTTPS
- Success currently means `lpass` login succeeded
- LastPass-to-local-vault sync is not yet implemented
- GitHub PAT found in LastPass appears stale and needs rotation or replacement

## Next likely improvements

- add HTTPS or reverse-proxy protection
- add LastPass cache sync after unseal
- add explicit reseal flow
- replace polling loop with a cleaner trigger model
