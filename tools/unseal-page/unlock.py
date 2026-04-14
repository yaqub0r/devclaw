#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
import sys
import time

STATE_DIR = pathlib.Path(os.environ.get('UNSEAL_STATE_DIR', '/home/sai/.openclaw/workspace/state/unseal'))
STATE_PATH = STATE_DIR / 'state.json'
SECRET_PATH = STATE_DIR / 'boot-secret.txt'
RESULT_PATH = STATE_DIR / 'result.json'

LPASS_USER = os.environ.get('LPASS_USER', '').strip()


def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2))
    os.chmod(STATE_PATH, 0o600)


def save_result(ok, message, extra=None):
    payload = {
        'ok': ok,
        'message': message,
        'timestamp': int(time.time()),
    }
    if extra:
        payload.update(extra)
    RESULT_PATH.write_text(json.dumps(payload, indent=2))
    os.chmod(RESULT_PATH, 0o600)


def set_status(status, error=None):
    state = load_state()
    state['status'] = status
    state['lastError'] = error
    if status == 'unsealed':
        state['unsealedAt'] = int(time.time() * 1000)
    save_state(state)


def lpass_login(password: str):
    if not LPASS_USER:
        return False, 'LPASS_USER not set'
    env = os.environ.copy()
    env['LPASS_DISABLE_PINENTRY'] = '1'
    env['LPASS_ASKPASS'] = '/home/sai/.openclaw/workspace/tools/unseal-page/askpass.sh'
    env['UNSEAL_SECRET_FILE'] = str(SECRET_PATH)
    proc = subprocess.run(
        ['lpass', 'login', '--trust', LPASS_USER],
        text=True,
        capture_output=True,
        timeout=120,
        env=env,
    )
    if proc.returncode == 0:
        return True, 'LastPass login ok'
    stderr = (proc.stderr or '').strip()
    stdout = (proc.stdout or '').strip()
    msg = stderr or stdout or f'login failed rc={proc.returncode}'
    return False, msg


def main():
    if not SECRET_PATH.exists():
        save_result(False, 'boot secret missing')
        return 1
    password = SECRET_PATH.read_text()
    if not password:
        save_result(False, 'boot secret empty')
        return 1

    set_status('processing')
    ok, message = lpass_login(password)

    if ok:
        sync = subprocess.run(
            ['python3', '/home/sai/.openclaw/workspace/tools/unseal-page/sync_lastpass_to_vault.py'],
            text=True,
            capture_output=True,
            timeout=180,
        )
        try:
            SECRET_PATH.unlink(missing_ok=True)
        except Exception:
            pass
        if sync.returncode == 0:
            set_status('unsealed')
            save_result(True, 'LastPass login ok; vault synced', {'sync': (sync.stdout or '').strip()})
            return 0
        msg = (sync.stderr or sync.stdout or 'vault sync failed').strip()
        set_status('failed', msg)
        save_result(False, msg)
        return 3

    try:
        SECRET_PATH.unlink(missing_ok=True)
    except Exception:
        pass
    set_status('failed', message)
    save_result(False, message)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
