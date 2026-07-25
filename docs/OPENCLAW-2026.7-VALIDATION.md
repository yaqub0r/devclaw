# OpenClaw 2026.7 host validation

Use this runbook after the compatibility PR is merged into `devclaw-local-dev`.
It deliberately separates repository validation from the live gateway restart:
the development agent can prove the code and request contracts locally, while
the host agent owns loading the plugin and exercising a real OpenClaw gateway.

## What this validates

- DevClaw uses `runtime.subagent.run` for accepted worker launches.
- The public `agent` request never receives the removed `spawnedBy` field.
- `sessions.patch` records the worker's `spawnedBy` lineage.
- Deterministic worker session keys are reused across feedback cycles.
- Channel, account, and Telegram topic routing reaches the worker task.
- A rejected model/session patch or worker launch cannot strand an active slot.
- DevClaw does not silently substitute a different worker model.

## 1. Sync and build

Do not perform these steps until the PR is merged.

```bash
git switch devclaw-local-dev
git pull --ff-only
npm ci
npm run test:gateway-dispatch
npm run build
```

Expected: all gateway-dispatch tests pass and `dist/index.js` is rebuilt.

## 2. Inspect the live gateway before mutation

```bash
openclaw --version
openclaw gateway call status --json
openclaw gateway call models.list --params '{"view":"configured"}' --json
```

Record the exact OpenClaw version. Confirm the model configured for the
project's architect role/level appears in the configured model response.
If it does not, set an explicit project model override through the existing
DevClaw configuration workflow. Do not change DevClaw's global defaults and do
not rely on automatic model substitution.

## 3. Load and restart

Load the rebuilt DevClaw plugin using the host's existing plugin deployment
method, then restart the gateway:

```bash
openclaw gateway restart
```

Check the gateway logs and confirm that DevClaw registers without schema
warnings or plugin initialization errors.

## 4. Recover and dispatch the smoke issue

Use Firstlight issue `#902` if it remains available:

1. Return it to `To Research`.
2. Ensure its architect slot is inactive before dispatch.
3. Trigger the normal Firstlight queue/heartbeat path from the project-bound
   chat topic.
4. Record the returned `runId` and deterministic child `sessionKey`.

The child key should have this shape:

```text
agent:<agent-id>:subagent:firstlight-architect-<level>-<worker-name>
```

The launch is accepted only after `sessions.patch` and `runtime.subagent.run`
both succeed. If either rejects, `#902` must remain or return to `To Research`
and the architect slot must remain inactive.

## 5. Verify lineage and routing

Inspect the child session through the gateway's session view or session store:

```bash
openclaw gateway call status --json
```

Confirm:

- the child session key matches the key stored in DevClaw's worker slot;
- the session model matches the project role/level model;
- `spawnedBy` points to the Firstlight orchestrator session;
- the orchestrator's `/subagents` view shows the worker under that parent;
- the worker task contains `channel`, `channelId`, `accountId` when configured,
  and `messageThreadId` for a Telegram topic;
- the worker calls `work_finish` with the same `channelId` and
  `messageThreadId`, and the completion is applied to Firstlight rather than
  another project in the same chat.

For task-ledger-enabled gateways, also inspect the ledger:

```bash
openclaw gateway call tasks.list --params '{"sessionKey":"<parent-session-key>","limit":50}' --json
```

Match the ledger's `runId`/child session to the DevClaw dispatch audit entry.

## 6. Failure and reuse checks

Run these after the successful smoke dispatch:

1. Temporarily select a known disallowed project model and queue a disposable
   issue. DevClaw should reject it before label transition when the configured
   catalog is readable. The issue stays queued and the slot stays inactive.
2. Restore the valid project model.
3. Send `#902` through one feedback cycle. The second dispatch must reuse the
   same child `sessionKey`, return a new `runId`, and retain its parent lineage.
4. If practical, exercise the stalled-worker nudge. It must target the same
   deterministic child session without creating a replacement slot.

## Evidence to return

Return these items to the development side:

- OpenClaw version;
- DevClaw registration log line;
- configured model used for the smoke worker;
- parent session key, child session key, and accepted run ID;
- session metadata showing parent lineage;
- `/subagents` or task-ledger evidence;
- final state of `#902` and its architect slot;
- any gateway rejection or DevClaw rollback log.
