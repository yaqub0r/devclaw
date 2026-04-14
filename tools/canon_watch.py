#!/usr/bin/env python3
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path('/home/sai/.openclaw/workspace')
STATE_DIR = ROOT / 'state' / 'canon-watch'
SNAPSHOT_PATH = STATE_DIR / 'snapshot.json'
PENDING_PATH = STATE_DIR / 'pending.json'
CONFIG_PATH = ROOT / 'process' / 'canon-watch.json'


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def sha256_file(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def git_diff(relpath: str):
    proc = subprocess.run(
        ['git', '-C', str(ROOT), 'diff', '--', relpath],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.stdout.strip()


def build_snapshot(files):
    out = {}
    for rel in files:
        p = ROOT / rel
        if p.exists() and p.is_file():
            out[rel] = {
                'sha256': sha256_file(p),
                'size': p.stat().st_size,
            }
        else:
            out[rel] = {
                'missing': True,
            }
    return out


def cmd_check():
    cfg = load_json(CONFIG_PATH, {'watch': []})
    files = cfg.get('watch', [])
    current = build_snapshot(files)
    previous = load_json(SNAPSHOT_PATH, {})
    pending = load_json(PENDING_PATH, {'items': []})
    existing = {item['path']: item for item in pending.get('items', [])}

    changed = []
    for rel, meta in current.items():
        if previous.get(rel) != meta:
            item = {
                'path': rel,
                'detectedAt': now_iso(),
                'current': meta,
                'previous': previous.get(rel),
                'diff': git_diff(rel),
                'status': 'pending',
            }
            existing[rel] = item
            changed.append(rel)

    save_json(SNAPSHOT_PATH, current)
    pending_items = list(existing.values())
    pending_items.sort(key=lambda x: x['path'])
    save_json(PENDING_PATH, {'items': pending_items})

    print(json.dumps({
        'changed': changed,
        'pendingCount': sum(1 for i in pending_items if i.get('status') == 'pending'),
    }, indent=2))


def cmd_status():
    pending = load_json(PENDING_PATH, {'items': []})
    print(json.dumps(pending, indent=2))


def set_status(path: str, status: str):
    pending = load_json(PENDING_PATH, {'items': []})
    found = False
    for item in pending.get('items', []):
        if item.get('path') == path:
            item['status'] = status
            item['reviewedAt'] = now_iso()
            found = True
    if not found:
        raise SystemExit(f'No pending item for {path}')
    save_json(PENDING_PATH, pending)
    print(json.dumps({'path': path, 'status': status}, indent=2))


def cmd_accept(path: str):
    set_status(path, 'accepted')


def cmd_reject(path: str):
    proc = subprocess.run(
        ['git', '-C', str(ROOT), 'checkout', '--', path],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.strip() or f'Failed to reject {path}')
    set_status(path, 'rejected')


def cmd_summary():
    pending = load_json(PENDING_PATH, {'items': []})
    items = [i for i in pending.get('items', []) if i.get('status') == 'pending']
    if not items:
        print('No pending canon changes.')
        return
    lines = ['Pending canon changes:']
    for item in items:
        lines.append(f"- {item['path']}")
    print('\n'.join(lines))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: canon_watch.py check|status|summary|accept <path>|reject <path>')
    cmd = sys.argv[1]
    if cmd == 'check':
        cmd_check()
    elif cmd == 'status':
        cmd_status()
    elif cmd == 'summary':
        cmd_summary()
    elif cmd == 'accept' and len(sys.argv) == 3:
        cmd_accept(sys.argv[2])
    elif cmd == 'reject' and len(sys.argv) == 3:
        cmd_reject(sys.argv[2])
    else:
        raise SystemExit('usage: canon_watch.py check|status|summary|accept <path>|reject <path>')
