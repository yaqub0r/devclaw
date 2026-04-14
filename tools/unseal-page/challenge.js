#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const statePath = process.env.UNSEAL_STATE_PATH || '/home/sai/.openclaw/workspace/state/unseal/state.json';
try {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  process.stdout.write(JSON.stringify({ status: state.status, challenge: state.challenge, expiresAt: state.expiresAt }) + '\n');
} catch (err) {
  process.stderr.write(`failed to read challenge: ${err.message}\n`);
  process.exit(1);
}
