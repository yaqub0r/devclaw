# OpenClaw 2026.7 host validation

Use this runbook after the compatibility PR is merged into
`devclaw-local-dev`. Repository validation is performed before merge; the host
agent owns loading the plugin, restarting the gateway, and exercising the live
OpenClaw runtime.

## What this validates

- DevClaw launches workers through `runtime.subagent.run`.
- Native dispatch does not call the trusted-official-only
  `runtime.gateway.request` API.
- DevClaw passes its selected worker model as the run's `provider` and `model`
  override.
- OpenClaw returns a `runId` before DevClaw marks the worker slot active.
- A rejected model override or worker launch returns the issue to its queue and
  leaves the slot inactive.
- Deterministic worker session keys are reused across feedback cycles.
- The public session-store helper records the worker label and parent lineage
  when available.
- Channel, account, and Telegram topic routing reaches the worker task.
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

## 2. Authorize DevClaw's worker model overrides

OpenClaw 2026.7 allows an untrusted/local plugin to call
`runtime.subagent.run`, but explicit `provider`/`model` overrides require host
operator opt-in. Add the DevClaw models used by this host to the plugin entry:

```json5
{
  plugins: {
    entries: {
      devclaw: {
        enabled: true,
        subagent: {
          allowModelOverride: true,
          allowedModels: [
            "openai/<configured-worker-model>",
            "google/<configured-worker-model>",
          ],
        },
      },
    },
  },
}
```

Use the exact canonical `provider/model` values selected by the configured
DevClaw projects. Do not use `"*"` unless the host intentionally trusts
DevClaw to select any configured model. Every allowed target must also be
available through the host's normal OpenClaw model configuration.

This policy authorizes DevClaw's existing project/role/level selections; it
does not change DevClaw's global defaults or introduce model substitution.

## 3. Inspect the live gateway before mutation

```bash
openclaw --version
openclaw gateway call status --json
```

Record the exact OpenClaw version and confirm the expected worker providers are
healthy. If a project selects a model this host does not provide, set an
explicit project model override through the existing DevClaw configuration
workflow and add that exact model to `allowedModels`.

## 4. Load and restart

Load the rebuilt DevClaw plugin using the host's existing plugin deployment
method, then restart the gateway:

```bash
openclaw gateway restart
```

Check the gateway logs and confirm that DevClaw registers without schema
warnings or plugin initialization errors.

## 5. Recover and dispatch the smoke issue

Choose a disposable research issue in a project-bound chat or topic:

1. Return it to `To Research`.
2. Ensure its architect slot is inactive before dispatch.
3. Trigger the normal project queue/heartbeat path.
4. Record the returned `runId` and deterministic child `sessionKey`.

The child key should have this shape:

```text
agent:<agent-id>:subagent:<project-slug>-architect-<level>-<worker-name>
```

The launch is accepted only after `runtime.subagent.run` returns a non-empty
`runId`. If OpenClaw rejects the model policy or launch request, the smoke issue
must remain or return to `To Research`, and the architect slot must remain
inactive.

## 6. Verify model, lineage, and routing

Inspect the child through the gateway's normal session and task views:

```bash
openclaw gateway call status --json
```

Confirm:

- the child session key matches the key stored in DevClaw's worker slot;
- the session model matches the project role/level model;
- `spawnedBy` points to the correct project orchestrator session;
- the worker is represented as a plugin-owned subagent run;
- the worker task contains `channel`, `channelId`, `accountId` when configured,
  and `messageThreadId` for a Telegram topic;
- the worker calls `work_finish` with the same `channelId` and
  `messageThreadId`, and completion applies to the selected project.

For task-ledger-enabled gateways, inspect the ledger as well:

```bash
openclaw gateway call tasks.list --params '{"sessionKey":"<parent-session-key>","limit":50}' --json
```

Match its run/session identity to the DevClaw dispatch audit entry.

## 7. Failure and reuse checks

After a successful smoke dispatch:

1. Temporarily remove the selected test model from
   `plugins.entries.devclaw.subagent.allowedModels` and restart the gateway.
2. Queue a disposable issue. OpenClaw must reject the override; DevClaw must
   return the issue to its queue and leave the slot inactive.
3. Restore the policy and restart.
4. Send the smoke issue through one feedback cycle. The second dispatch must
   reuse the same child `sessionKey`, return a new `runId`, and retain its
   parent lineage.
5. If practical, exercise the stalled-worker nudge. It must target the same
   deterministic child session without creating a replacement slot.

## Evidence to return

- OpenClaw version;
- DevClaw registration log line;
- configured model and matching plugin `allowedModels` entry;
- parent session key, child session key, and accepted run ID;
- session metadata showing parent lineage;
- subagent/task-ledger evidence;
- final state of the smoke issue and its architect slot;
- any OpenClaw rejection and corresponding DevClaw rollback log.
