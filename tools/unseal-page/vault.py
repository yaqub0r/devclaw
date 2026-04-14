#!/usr/bin/env python3
import base64
import json
import os
import pathlib
import secrets
import sys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.fernet import Fernet

VAULT_DIR = pathlib.Path(os.environ.get('OPENCLAW_VAULT_DIR', '/home/sai/.openclaw/workspace/state/vault'))
META_PATH = VAULT_DIR / 'meta.json'
VAULT_PATH = VAULT_DIR / 'vault.json.enc'
KEY_CACHE_PATH = VAULT_DIR / 'session.key'


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000)
    return base64.urlsafe_b64encode(kdf.derive(password.encode('utf-8')))


def ensure_dir():
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(VAULT_DIR, 0o700)


def init(password: str):
    ensure_dir()
    if META_PATH.exists() or VAULT_PATH.exists():
        return
    salt = secrets.token_bytes(16)
    key = derive_key(password, salt)
    enc = Fernet(key).encrypt(b'{}')
    META_PATH.write_text(json.dumps({'salt': base64.b64encode(salt).decode('ascii')}, indent=2))
    VAULT_PATH.write_bytes(enc)
    os.chmod(META_PATH, 0o600)
    os.chmod(VAULT_PATH, 0o600)
    KEY_CACHE_PATH.write_bytes(key)
    os.chmod(KEY_CACHE_PATH, 0o600)


def load_key(password: str | None = None) -> bytes:
    if KEY_CACHE_PATH.exists():
        return KEY_CACHE_PATH.read_bytes()
    meta = json.loads(META_PATH.read_text())
    salt = base64.b64decode(meta['salt'])
    if password is None:
        raise RuntimeError('vault password required')
    key = derive_key(password, salt)
    KEY_CACHE_PATH.write_bytes(key)
    os.chmod(KEY_CACHE_PATH, 0o600)
    return key


def read(password: str | None = None):
    key = load_key(password)
    raw = Fernet(key).decrypt(VAULT_PATH.read_bytes())
    return json.loads(raw.decode('utf-8'))


def write(data):
    key = load_key()
    enc = Fernet(key).encrypt(json.dumps(data, sort_keys=True).encode('utf-8'))
    VAULT_PATH.write_bytes(enc)
    os.chmod(VAULT_PATH, 0o600)


def redact(obj):
    if isinstance(obj, dict):
        return {k: redact(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    if isinstance(obj, str):
        return '__REDACTED__'
    return obj


def main():
    cmd = sys.argv[1]
    if cmd == 'init':
        init(sys.argv[2])
    elif cmd == 'read':
        data = read(sys.argv[2] if len(sys.argv) > 2 else None)
        print(json.dumps(redact(data), indent=2))
    elif cmd == 'dump-unsafe':
        data = read(sys.argv[2] if len(sys.argv) > 2 else None)
        print(json.dumps(data, indent=2))
    elif cmd == 'write-stdin':
        data = json.load(sys.stdin)
        write(data)
    else:
        raise SystemExit('unknown command')

if __name__ == '__main__':
    main()
