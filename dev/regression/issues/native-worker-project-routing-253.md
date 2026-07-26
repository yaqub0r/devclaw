# Regression note: native worker project routing, issue #253

- Related issue: #253
- Scope: let plugin-native workers call project tools when OpenClaw exposes their synthetic turn as `webchat`, without weakening project isolation

## Change summary

Native `runtime.subagent.run` turns do not inherit the project's registered
transport in their tool context. DevClaw now resolves recognized worker calls
from the deterministic session identity and its active persisted slot before
consulting chat transport scope. The explicit route must still belong to that
project.

## Triggering conditions

- a worker is launched through the plugin-native subagent runtime
- its tool context reports `messageChannel: "webchat"`
- its task carries the project's registered `channelId`
- it calls a project tool such as `task_comment`, `task_create`, or
  `work_finish`

## Automated coverage

`npm run test:gateway-dispatch` verifies that:

1. an active registered worker resolves its project despite the
   synthetic `webchat` source
2. ordinary non-worker sessions retain channel-scoped resolution
3. forged and inactive worker sessions are rejected
4. a valid worker cannot use a route owned by another project
5. existing native dispatch, legacy dispatch, and completion-message routing
   contracts continue to pass

## Manual validation notes

After deployment, resume one held worker and confirm that its project action
and `work_finish` call succeed without `No project found`, then verify there is
one `worker.completed` event and no six-minute redispatch loop.
