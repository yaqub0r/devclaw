#!/usr/bin/env python3
import getpass
import json
import os
import pathlib
import subprocess
from vault import init, read, write

MAP_PATH = pathlib.Path('/home/sai/.openclaw/workspace/state/vault/lpass-map.json')
DEFAULT_ITEMS = {
    'github.pat': '2662057034254934541',
    'github.account': '1138842277103865951',
}


def lpass_show(item_id: str) -> str:
    p = subprocess.run(['lpass', 'show', '--password', item_id], text=True, capture_output=True, timeout=60)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or f'lpass show failed for {item_id}').strip())
    return p.stdout.strip()


def main():
    password = getpass.getpass('Vault password: ')
    vault_dir = pathlib.Path('/home/sai/.openclaw/workspace/state/vault')
    vault_dir.mkdir(parents=True, exist_ok=True)
    if not MAP_PATH.exists():
        MAP_PATH.write_text(json.dumps(DEFAULT_ITEMS, indent=2))
        os.chmod(MAP_PATH, 0o600)
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
    print(json.dumps({'ok': True, 'keys': sorted(synced.keys())}))

if __name__ == '__main__':
    main()
