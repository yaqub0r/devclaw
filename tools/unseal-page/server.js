#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.UNSEAL_PORT || 18888);
const HOST = process.env.UNSEAL_HOST || '127.0.0.1';
const STATE_DIR = process.env.UNSEAL_STATE_DIR || '/home/sai/.openclaw/workspace/state/unseal';
const HTML_PATH = path.join(__dirname, 'unseal.html');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const MAX_BODY = 16 * 1024;
const TTL_MS = Number(process.env.UNSEAL_TTL_MS || 10 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.UNSEAL_MAX_ATTEMPTS || 5);
const SHUTDOWN_AFTER_SUCCESS_MS = Number(process.env.UNSEAL_SHUTDOWN_AFTER_SUCCESS_MS || 15000);

const EMOTES = ['🦊', '🫡', '🌙', '✨', '🛡️', '🔐', '🧠', '👀', '🪄', '🐙', '🌿', '🧿', '🔥', '🎯', '🫧', '🧩'];

fs.mkdirSync(STATE_DIR, { recursive: true });

function pickChallenge() {
  const chosen = [];
  while (chosen.length < 5) {
    const candidate = EMOTES[Math.floor(Math.random() * EMOTES.length)];
    if (!chosen.includes(candidate)) chosen.push(candidate);
  }
  return chosen;
}

function newState() {
  return {
    status: 'sealed',
    challenge: pickChallenge(),
    token: crypto.randomBytes(16).toString('hex'),
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
    lastError: null,
    submittedAt: null,
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return newState();
    return parsed;
  } catch {
    return newState();
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

let state = loadState();
if (!state.challenge || Date.now() > (state.expiresAt || 0)) {
  state = newState();
  saveState(state);
}

let shutdownTimer = null;

function scheduleShutdownIfNeeded() {
  if (shutdownTimer) return;
  if (state.status !== 'unsealed') return;
  shutdownTimer = setTimeout(() => {
    process.exit(0);
  }, SHUTDOWN_AFTER_SUCCESS_MS);
}

function resetState() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  state = newState();
  saveState(state);
  return state;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

const server = http.createServer(async (req, res) => {
  state = loadState();
  if (Date.now() > (state.expiresAt || 0) && state.status === 'sealed') resetState();

  if (state.status === 'unsealed') {
    scheduleShutdownIfNeeded();
  }

  if (req.method === 'GET' && req.url === '/') {
    const html = fs.readFileSync(HTML_PATH, 'utf8')
      .replaceAll('__STATUS__', state.status)
      .replaceAll('__CHALLENGE__', state.challenge.join('  '))
      .replaceAll('__TOKEN__', state.token)
      .replaceAll('__EXPIRES__', String(state.expiresAt));
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && req.url === '/api/challenge') {
    let result = null;
    try {
      result = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'result.json'), 'utf8'));
    } catch {}
    return send(res, 200, JSON.stringify({ status: state.status, challenge: state.challenge, expiresAt: state.expiresAt, result }));
  }

  if (req.method === 'POST' && req.url === '/api/unseal') {
    if (state.status !== 'sealed') {
      return send(res, 409, JSON.stringify({ ok: false, status: state.status }));
    }
    if (state.attempts >= MAX_ATTEMPTS) {
      return send(res, 429, JSON.stringify({ ok: false, error: 'locked' }));
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (body.token !== state.token) {
        state.attempts += 1;
        state.lastError = 'bad_token';
        saveState(state);
        return send(res, 403, JSON.stringify({ ok: false, error: 'forbidden' }));
      }
      if (typeof body.password !== 'string' || !body.password.length) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'missing_password' }));
      }
      const secretPath = path.join(STATE_DIR, 'boot-secret.txt');
      fs.writeFileSync(secretPath, body.password, { mode: 0o600 });
      try { fs.unlinkSync(path.join(STATE_DIR, 'result.json')); } catch {}
      state.status = 'submitted';
      state.submittedAt = Date.now();
      state.lastError = null;
      saveState(state);
      return send(res, 200, JSON.stringify({ ok: true, status: state.status, ip: clientIp(req) }));
    } catch (err) {
      state.attempts += 1;
      state.lastError = err && err.message ? err.message : 'bad_request';
      saveState(state);
      return send(res, err && err.message === 'too_large' ? 413 : 400, JSON.stringify({ ok: false, error: 'bad_request' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/reset') {
    try { fs.unlinkSync(path.join(STATE_DIR, 'boot-secret.txt')); } catch {}
    try { fs.unlinkSync(path.join(STATE_DIR, 'result.json')); } catch {}
    resetState();
    return send(res, 200, JSON.stringify({ ok: true, status: state.status, challenge: state.challenge, expiresAt: state.expiresAt }));
  }

  send(res, 404, JSON.stringify({ ok: false, error: 'not_found' }));
});

saveState(state);

server.listen(PORT, HOST, () => {
  console.log(`unseal-page listening on http://${HOST}:${PORT}`);
});
