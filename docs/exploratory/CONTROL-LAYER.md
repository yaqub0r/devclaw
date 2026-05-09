# Control Layers

How DevClaw controls agent behavior, from least to most reliable.

---

## The Stack

```
                    Reliability

  Prompt            ░░░░░░░░░░  Soft — LLM can ignore
  Tool Schema       ▓▓▓▓▓▓░░░░  Medium — call rejected on wrong values
  Code              ██████████  Hard — deterministic, throws on violation
  Config            ██████████  Hard — validated at load time
  Heartbeat         ██████████  Hard — autonomous, zero tokens
  Platform          ██████████  External — GitHub/GitLab enforced
```

---

## Layer 1: Prompts (Soft)

Instructions injected into the LLM context. The agent *should* follow them but *can* ignore, misinterpret, or forget them. No enforcement mechanism.

### What's controlled

| File | Injected via | Controls |
|---|---|---|
| `devclaw/prompts/architect.md` | Bootstrap hook → `WORKER_INSTRUCTIONS.md` | Research 3+ alternatives, post findings, create task before finishing |
| `devclaw/prompts/developer.md` | Bootstrap hook → `WORKER_INSTRUCTIONS.md` | Work in worktrees, don't merge PR, no closing keywords in PR description |
| `devclaw/prompts/reviewer.md` | Bootstrap hook → `WORKER_INSTRUCTIONS.md` | Review diff only, call task_comment first, then approve/reject |
| `devclaw/prompts/tester.md` | Bootstrap hook → `WORKER_INSTRUCTIONS.md` | Run tests, always call task_comment with findings |
| `devclaw/prompts/release.md` | Bootstrap hook → `WORKER_INSTRUCTIONS.md` | Promotion steps, lane checks, release evidence, rollback handling |
| `AGENTS.md` | Workspace context file | Orchestrator must never write code, priority ordering, tool restrictions |
| `SOUL.md` / `IDENTITY.md` | Workspace context file | Personality, communication style |
| `buildTaskMessage()` | Appended to task message | Mandatory completion block: "you MUST call work_finish" with valid results |

### Prompt resolution

Role prompts are resolved per-project with fallback:
1. `devclaw/projects/<project>/prompts/<role>.md`
2. `devclaw/prompts/<role>.md`

Release work uses `release.md` as its dedicated prompt surface.

### What can go wrong

- Architect calls `work_finish(done)` without creating a task — **no code guard**
- Developer uses `Closes #42` in PR description — GitHub auto-closes, bypasses review lifecycle — **no code guard**
- Tester calls `work_finish(pass)` without posting a `task_comment` — **no code guard**
- Orchestrator writes code directly instead of dispatching a worker — **no code guard**

---

## Layer 2: Tool Schemas (Medium)

JSON Schema constraints on tool parameters. The LLM framework **rejects the call** if the schema is violated — the tool never executes. But the LLM can choose not to call the tool at all.

### What's enforced

| Tool | Constraint | Type |
|---|---|---|
| `work_finish` | `role` must be one of `["developer","tester","architect","reviewer"]` | `enum` |
| `work_finish` | `result` must be one of `["done","pass","fail","refine","blocked","approve","reject"]` | `enum` |
| `task_create` | `label` must be a valid workflow state label | `enum` |
| `research_task` | `complexity` must be `"simple"`, `"medium"`, or `"complex"` | `enum` |
| `task_comment` | `authorRole` must be a known role or `"orchestrator"` | `enum` |
| `task_set_level` | `level` must be a valid role level | `enum` |
| All tools | `projectSlug` is required | `required` |

### Soft instructions in schemas

Tool descriptions include `IMPORTANT:` text. These are read by the LLM but not enforced:
- `task_create`: "Always creates in Planning unless the user explicitly asks to start work immediately"
- `research_task`: "Provide a detailed description with enough background context"

---

## Layer 3: Code (Hard)

Deterministic checks in `execute()` functions. These **throw errors** — the LLM gets the error back and must retry or give up. No prompt can bypass them.

### Guards

| Check | Where | What it prevents |
|---|---|---|
| `isValidResult(role, result)` | `tools/worker/work-finish.ts` | Developer calling `pass`, tester calling `approve`, etc. |
| `worker.active` guard | `tools/worker/work-finish.ts` | Finishing work that was never started |
| `validatePrExistsForDeveloper()` | `tools/worker/work-finish.ts` | Developer marking `done` without an open PR |
| `getRule(role, result, workflow)` | `tools/worker/work-finish.ts` | Any completion with no matching state transition |
| `worker.active` slot check | `tools/tasks/task-start.ts` | Two workers of the same role running simultaneously |
| Sequential execution check | `tools/tasks/task-start.ts` | Any role running while another is active (sequential mode) |
| Role mismatch guard | `tools/tasks/task-start.ts` | Dispatching a tester to a "To Do" issue |
| State label check | `tools/tasks/task-start.ts` | Dispatching to an issue with no recognized state |
| Editable-state guard | `tools/tasks/task-edit-body.ts` | Editing issue body while work is in progress |
| Empty body check | `tools/tasks/task-comment.ts` | Posting an empty comment |
| Required field checks | `tools/tasks/research-task.ts` | Creating a research task without description |

### Computed behavior (no LLM input)

| Mechanism | Where | What it does |
|---|---|---|
| Session key naming | `dispatch/session.ts` | Deterministic: `agent:{id}:subagent:{project}-{role}-{level}` |
| Review routing label | `dispatch/index.ts` | Computed from policy + level, applied as `review:human` or `review:agent` |
| Level selection heuristic | `roles/model-selector.ts` | Keywords in title/description → junior/medior/senior |
| Context budget clearing | `dispatch/index.ts` | Clears session when context > budget threshold |
| Eyes reaction (managed marker) | `tools/tasks/task-create.ts`, `dispatch/index.ts` | Applied automatically, used as filter in heartbeat |

---

## Layer 4: Config (Hard — validated at load time)

Three-layer merge: **built-in defaults → workspace yaml → project yaml**. Validated by Zod schema + workflow integrity checks. Invalid config is rejected at load time.

### What's configurable

| Setting | Default | Effect |
|---|---|---|
| `workflow.reviewPolicy` | `human` | `human` / `agent` / `auto` — controls review routing |
| `workflow.testPolicy` | `skip` | `skip` / `agent` — controls test routing |
| `workflow.delivery.promotion.policy` | `skip` | `skip` / `agent` / `human` — controls promotion routing |
| `workflow.delivery.acceptance.policy` | `skip` | `skip` / `agent` / `human` — controls acceptance routing |
| `workflow.delivery.promotion.queueState` | `toPromote` | Queue state used for promotion |
| `workflow.delivery.promotion.activeState` | `promoting` | Active state used for promotion |
| `workflow.delivery.acceptance.queueState` | `toAccept` | Queue state used for acceptance |
| `workflow.delivery.acceptance.activeState` | `accepting` | Active state used for acceptance |
| `roles.<role>.models` | Registry defaults | Which model runs at each level |
| `roles.<role>.levels` | Registry defaults | Available level names |
| `roles.<role>.completionResults` | Registry defaults | Valid results for `work_finish` |
| `roles.<role>: false` | Enabled | Disables a role entirely |
| `workflow.states` | `DEFAULT_WORKFLOW` | Full statechart override |
| `timeouts.staleWorkerHours` | 2 | When heartbeat flags stale workers |
| `timeouts.sessionContextBudget` | 0.6 | Context ratio for session clearing |
| `timeouts.dispatchMs` | 600,000 | Max dispatch turn time |

### Per-issue overrides (labels)

| Label | Effect |
|---|---|
| `review:human` | Force human PR review |
| `review:agent` | Force agent PR review |
| `review:skip` | Skip review |
| `test:agent` | Route through tester phase |
| `test:skip` | Skip test phase |
| `promotion:human` | Route promotion through human-controlled delivery pass |
| `promotion:agent` | Route promotion through agent reviewer pickup |
| `promotion:skip` | Skip promotion and advance on heartbeat |
| `acceptance:human` | Route acceptance through human-controlled delivery pass |
| `acceptance:agent` | Route acceptance through agent tester pickup |
| `acceptance:skip` | Skip acceptance and close on heartbeat |

---

## Layer 5: Heartbeat (Hard — autonomous, zero tokens)

Runs as a `setInterval` inside the gateway. No LLM involved. Fully deterministic.

### Health pass — auto-fixes

| Condition | Fix |
|---|---|
| Session dead (gateway says missing) | Revert label to queue, deactivate worker |
| Label mismatch (label changed externally) | Deactivate worker |
| Stale worker (active > N hours) | Revert label to queue, deactivate |
| Orphaned label (no tracked worker) | Revert label to queue |
| Orphaned session (not in any project) | Delete gateway session |
| Context overflow (`abortedLastRun`) | Revert label, clear session, deactivate |

### Review pass — PR polling

For issues in review states with `review:human` + eyes marker:
- PR approved/merged → merge PR, close issue → Done
- Changes requested / has comments → To Improve (developer re-dispatched)
- Merge conflict → To Improve
- Merge failure → To Improve

### Delivery pass — promotion and acceptance routing

For issues in delivery queue states:
- `promotion:agent` → reviewer pickup path (`To Promote` → `Promoting`)
- `promotion:skip` → heartbeat advances promotion without reviewer pickup
- `promotion:human` → heartbeat advances only when a current candidate record exists with status `active`
- `acceptance:agent` → tester pickup path (`To Accept` → `Accepting`)
- `acceptance:skip` → heartbeat marks the candidate `accepted`, advances, and closes per workflow
- `acceptance:human` → heartbeat advances only when a current candidate record exists with status `accepted`

The delivery pass uses the configured promotion and acceptance queue states, reads per-issue routing labels, and performs deterministic label transitions plus close/reopen actions from the workflow statechart.

### Tick pass — queue scanning

Fills free worker slots by priority. Respects: one worker per role, sequential mode, maxPickupsPerTick (default 4), review/test skip labels.

---

## Layer 6: Platform (External)

GitHub/GitLab settings that DevClaw reads but does not configure.

| Setting | Effect on DevClaw |
|---|---|
| Branch protection | Merge API fails if checks not met → heartbeat catches, transitions to To Improve |
| Required reviews | PR not reported as approved until reviewer approves |
| CI checks | DevClaw doesn't check these; branch protection gates the merge |
| CODEOWNERS | Not referenced by DevClaw |

---

## Reliability Summary

| What | Enforced by | Can agent bypass? |
|---|---|---|
| Architect must create task before finishing | Prompt | Yes |
| Developer must not use closing keywords | Prompt | Yes |
| Tester must post comment before completing | Prompt | Yes |
| Orchestrator must not write code | Prompt | Yes |
| Tool params must match schema types/enums | Tool framework | No (call rejected) |
| Developer can't finish without a PR | Code (`validatePrExistsForDeveloper`) | No |
| Can't finish with wrong role:result pair | Code (`isValidResult`) | No |
| Can't run two workers of same role | Code (slot check) | No |
| Review routing (human/agent/auto) | Code (computed label) | No |
| Test routing (`test:agent` / `test:skip`) | Code (computed label) | No |
| Delivery routing (`promotion:*`, `acceptance:*`) | Code (computed label) | No |
| Auto-merge only for managed issues | Code (eyes reaction filter) | No |
| Stale worker cleanup | Heartbeat (autonomous) | N/A |
| PR approval detection | Heartbeat (autonomous) | N/A |
| Delivery-phase advancement for skip/human routes | Heartbeat (autonomous) | N/A |
| Branch protection | GitHub/GitLab | N/A |
