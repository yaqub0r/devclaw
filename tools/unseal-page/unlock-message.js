#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const stateDir = process.env.UNSEAL_STATE_DIR || '/home/sai/.openclaw/workspace/state/unseal';
const statePath = path.join(stateDir, 'state.json');
const port = process.env.UNSEAL_PORT || '18888';

function pickHost() {
  if (process.env.UNSEAL_PUBLIC_HOST) return process.env.UNSEAL_PUBLIC_HOST;
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal && entry.address.startsWith('192.')) {
        return entry.address;
      }
    }
  }
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return '127.0.0.1';
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const challenge = Array.isArray(state.challenge) ? state.challenge.join(' ') : '';
const bindHost = pickHost();
const message = `Unlock page: http://${bindHost}:${port}\nChallenge: ${challenge}`;
process.stdout.write(message + '\n');
