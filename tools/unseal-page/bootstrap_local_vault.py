#!/usr/bin/env python3
import json
import os
import secrets
import string
import subprocess
from pathlib import Path
from vault import init, read, write

MAP_PATH = Path('/home/sai/.openclaw/workspace/state/vault/lpass-map.json')
DEFAULT_ITEMS = {
    'github.pat': '2662057034254934541',
    'github.account': '1138842277103865951',
}
VAULT_PASS_ITEM = 'OpenClaw Local Vault Password'


def rand_password(n=32):
    alphabet = string.ascii_letters + string.digits + '-_@#%+=' 
    return ''.join(secrets.choice(alphabet) for _ in range(n))


def run(cmd, **kwargs):
    p = subprocess.run(cmd, text=True, capture_output=True, **kwargs)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or f'command failed: {cmd}').strip())
    return p.stdout.strip()


def ensure_password_item():
    try:
        existing = run(['lpass', 'show', '--password', VAULT_PASS_ITEM], timeout=60)
        if existing:
            return existing
    except Exception:
        pass
    pw = rand_password()
    run(['lpass', 'add', '--non-interactive', '--password', VAULT_PASS_ITEM], input=pw + '\n', timeout=60)
    return run(['lpass', 'show', '--password', VAULT_PASS_ITEM], timeout=60)


def lpass_show(item_id: str) -> str:
    return run(['lpass', 'show', '--password', item_id], timeout=60)


def main():
    vault_dir = Path('/home/sai/.openclaw/workspace/state/vault')
    vault_dir.mkdir(parents=True, exist_ok=True)
    if not MAP_PATH.exists():
        MAP_PATH.write_text(json.dumps(DEFAULT_ITEMS, indent=2))
        os.chmod(MAP_PATH, 0o600)
    password = ensure_password_item()
    init(password)
    data = read(password)
    items = json.loads(MAP_PATH.read_text())
    synced = {}
    for key, item_id in items.items():
        try:
            synced[key] = lpass_show(item_id)
        except Exception as e:
            synced[key + '.__error__'] = str(e)
    data['lastpass'] = synced
    write(data)
    print(json.dumps({'ok': True, 'keys': sorted(synced.keys()), 'vaultPasswordItem': VAULT_PASS_ITEM}))

if __name__ == '__main__':
    main()
