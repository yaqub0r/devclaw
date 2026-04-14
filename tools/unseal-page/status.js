#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const stateDir = process.env.UNSEAL_STATE_DIR || '/home/sai/.openclaw/workspace/state/unseal';
const statePath = path.join(stateDir, 'state.json');
const resultPath = path.join(stateDir, 'result.json');
const out = {};
try { out.state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
try { out.result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch {}
process.stdout.write(JSON.stringify(out) + '\n');
