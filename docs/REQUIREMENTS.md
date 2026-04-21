# DevClaw v2 — Requirements

Requirements for the next iteration of DevClaw's task model: step-based execution, plan-driven workflows, and PR lifecycle standardization.

**Context:** [WORKFLOW-ALTERNATIVES.md](exploratory/WORKFLOW-ALTERNATIVES.md) (approach comparison), [STEP-BASED-TASKS.md](exploratory/STEP-BASED-TASKS.md) (early exploratory), #443 (dependency gating)

---

## 1. System Overview

DevClaw orchestrates AI development agents across GitHub and GitLab projects. The system has four control layers that influence how work flows:

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 4: Task Instructions (per-dispatch, per-issue)   │
│  "Fix the login bug. PR feedback attached."             │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: Role Prompts (per-role, per-project)          │
│  "You are a senior developer. Always run tests."        │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: Workflow State Machine (per-project)          │
│  States, transitions, review/test policies              │
├─────────────────────────────────────────────────────────┤
│  LAYER 1: Sessions & Slots (runtime)                    │
│  Which model, which worker, context budget              │
└─────────────────────────────────────────────────────────┘
```

**Layer 1 — Sessions & Slots** controls _who_ does the work. Model selection, worker pool sizing, session reuse, context budget. Configured in `workflow.yaml` and `projects.json`. Deterministic and zero-token.

**Layer 2 — Workflow State Machine** controls _when_ work moves. Label-driven state transitions on the issue tracker. Heartbeat scans queues, dispatches workers, handles PR lifecycle. Configured per-workspace or per-project in `workflow.yaml`.

**Layer 3 — Role Prompts** controls _how_ work is done. System-level instructions injected into worker sessions via the bootstrap hook. Per-role (`developer.md`, `tester.md`) and per-project overrides.

**Layer 4 — Task Instructions** controls _what_ work is done. Built from issue description, comments, PR feedback, attachments. Constructed fresh on each dispatch. Includes mandatory completion instructions (`work_finish` call).

---

## 2. Mental Models

### The Primitives

| Concept | Git artifact | Issue tracker artifact |
|---|---|---|
| **Issue** | Feature branch | GitHub/GitLab issue |
| **Step** | Commit (or commit group) | Row in the plan (issue body) |
| **PR** | Branch → main | Pull request / merge request |
| **Research** | (no code) | Issue with findings in comments |

### The Rule

**Every issue = 1 feature branch = 1 PR.**

This is the invariant. No exceptions. One issue, one branch, one PR.

Steps are _inside_ the issue. They produce commits on the issue's branch. The plan in the issue body tracks which steps are done. When the issue is complete (all steps done, or no steps at all), the PR gets reviewed and merged.

### Three Workflows

**1. Simple task — no plan needed**

```
Issue #42: Fix login timeout bug
  └─ branch: fix/42-login-timeout
       └─ commit: fix timeout handling
            └─ PR → main → review → merge → done
```

One issue, one branch, one commit, one PR. Created and executed in one shot. This is the current model — unchanged.

**2. Research — produces knowledge, not code**

```
Issue #50: Investigate auth provider options
  └─ no branch, no PR
       └─ architect posts findings as comments
            └─ creates Issue #51 (the implementation task) with a plan
```

Research issues have no branch and no PR. The output is knowledge (comments) and a follow-up task.

**3. Multi-step task — plan determines the steps**

```
Issue #51: Add OAuth authentication
  └─ branch: feat/51-oauth-auth
       ├─ step 1: Set up OAuth middleware      → commit(s)
       ├─ step 2: Add login/callback endpoints → commit(s)
       ├─ step 3: Write integration tests      → commit(s)
       └─ step 4: Update API docs              → commit(s)
            └─ PR → main (all steps) → review → merge → done
```

One issue, one branch, multiple steps (sequential commits), one PR. The plan lives in the issue body. Workers are dispatched step-by-step to the same branch. Each step commits to the branch. Review happens on the full PR once all steps are done (or after each step, via PR comments).

### Where Sub-Issues Fit

Sub-issues model **independent work items that happen to be related** — not sequential steps within one feature.

```
Issue #60: Overhaul authentication system [epic]
  ├─ Issue #61: Add OAuth provider       → own branch, own PR
  ├─ Issue #62: Migrate password hashing  → own branch, own PR
  └─ Issue #63: Update admin dashboard    → own branch, own PR
```

Each sub-issue follows the "1 issue = 1 branch = 1 PR" rule independently. Sub-issues can be sequenced (via dependency gating, #443) or parallel. Each can have its own plan with steps.

**Steps ≠ Sub-issues.** Steps are internal to an issue (commits on one branch). Sub-issues are separate issues (separate branches, separate PRs).

### Where Stacked PRs Fit

Stacked PRs are only relevant for **sub-issues with ordering**, not for steps.

```
Issue #60: Overhaul auth [epic, sequential]
  ├─ Issue #61: OAuth provider    → PR to main
  ├─ Issue #62: Password hashing  → PR stacked on #61's branch
  └─ Issue #63: Admin dashboard   → PR stacked on #62's branch
```

Steps within a single issue don't create separate PRs — they're commits on one branch. Stacking only happens between issues.

### Summary Table

| Scenario | Issues | Branches | PRs | Steps | Plan |
|---|---|---|---|---|---|
| Simple bug fix | 1 | 1 | 1 | none | none |
| Research | 1 | 0 | 0 | none | none |
| Multi-step feature | 1 | 1 | 1 | N (commits) | in issue body |
| Epic (independent parts) | 1 root + N | N | N | per sub-issue | per sub-issue |
| Epic (sequential parts) | 1 root + N | N | N (stacked) | per sub-issue | per sub-issue |

### The Plan Format

The plan lives in the issue body as YAML-in-comment (machine-readable) + rendered checklist (human-readable):

```markdown
<!-- devclaw:plan
mode: sequential
steps:
  - id: 1
    title: Set up OAuth middleware
    role: developer
    status: done
  - id: 2
    title: Add login/callback endpoints
    role: developer
    status: active
  - id: 3
    title: Write integration tests
    role: tester
    status: pending
  - id: 4
    title: Update API docs
    role: developer
    status: pending
-->

## Steps

- [x] Set up OAuth middleware — Done
- [ ] Add login/callback endpoints — Doing (developer:senior:Ada)
- [ ] Write integration tests — Pending
- [ ] Update API docs — Pending
```

- **YAML in HTML comment** — invisible when rendered, parsed by DevClaw (zero tokens)
- **Checklist below** — auto-rendered from the YAML, visible to humans
- **Single source of truth** — the issue body IS the plan
- **Updated deterministically** — heartbeat/pipeline reads YAML, flips status, re-renders checklist, writes back via `editIssue()` (2 CLI calls, zero tokens)

### What Stays Standardized: The PR Lifecycle

These behaviors happen around every code-producing issue, regardless of whether it has a plan:

| Outcome | Detection | Response |
|---|---|---|
| PR created | `work_finish(done)` | Detect PR, transition to review |
| PR approved | Heartbeat polls | Auto-merge, transition to Done |
| Changes requested | Heartbeat polls | Transition to To Improve with feedback |
| Merge conflict | Heartbeat polls `mergeable` | Transition to To Improve with rebase task |
| PR closed (no merge) | Heartbeat polls | Transition to Rejected |
| No PR found | `work_finish(done)` validation | Reject completion |

### Testing: Step vs. Phase

**Testing as a phase** (current): `testPolicy: agent` runs a tester after every PR merge. Applies to all issues in a project.

**Testing as a step** (new): The plan includes a tester step. Only planned issues that need testing get it. The tester works on the same branch — runs tests, commits fixes if needed.

Both coexist. Simple issues use phase-level testing. Planned issues use step-level testing (the plan overrides the phase).

---

## 3. Requirements

### R1: The Invariant — 1 Issue = 1 Branch = 1 PR

**R1.1** Every code-producing issue gets exactly one feature branch and one PR.

**R1.2** The branch naming convention is `{type}/{issueId}-{slug}` (e.g., `feat/51-oauth-auth`). Unchanged from current.

**R1.3** Steps are commits on the issue's branch — not separate branches or PRs. One branch, one PR, multiple commits.

**R1.4** Research issues have no branch and no PR. Their output is knowledge (comments, plan creation).

**R1.5** Sub-issues (epics) each follow R1.1 independently — each sub-issue gets its own branch and PR. Sub-issue ordering may use PR stacking (sub-issue N's PR targets sub-issue N-1's branch).

### R2: Plans — Steps Inside an Issue

**R2.1** An issue can have a **plan**: an ordered list of steps stored in the issue body.

**R2.2** The plan is stored as YAML inside an HTML comment (machine-readable) plus a rendered checklist (human-readable). Both live in the issue body. The YAML is the source of truth; the checklist is auto-generated.

**R2.3** Each step has: `id`, `title`, `role`, `status` (pending/active/done/skipped).

**R2.4** Steps are **sequential by default**. Step N+1 is not dispatched until step N is done. The queue scanner reads the plan YAML before dispatch to enforce this.

**R2.5** Issues without a plan work exactly as today (simple task: 1 dispatch, no steps).

**R2.6** Updating a step's status is deterministic: read issue body → parse YAML → update status → re-render checklist → write body. Zero LLM tokens. 2 CLI calls (`getIssue` + `editIssue`).

### R3: Step Dispatch

**R3.1** When the heartbeat picks up a planned issue, it reads the plan and dispatches the **next pending step** — not the whole issue.

**R3.2** The worker receives step-specific context in its task message: "You are working on step 2 of 4: Add login/callback endpoints. The previous step (Set up OAuth middleware) is done."

**R3.3** The worker commits to the issue's existing branch. If the branch doesn't exist yet (step 1), the worker creates it. If it exists (step 2+), the worker pulls and continues.

**R3.4** When the worker calls `work_finish(done)` for a step:
- The pipeline updates the plan YAML (step → done)
- Re-renders the checklist in the issue body
- If more steps remain: transitions issue back to queue (To Do) for the next step
- If all steps done: transitions to To Review (PR lifecycle takes over)

**R3.5** Between steps, the issue label cycles: To Do → Doing → (step done) → To Do → Doing → ... → To Review → Done. The plan YAML tracks which step is active; labels track the workflow state.

### R4: Roles and Steps

**R4.1** Each step has an assigned role (developer, tester, architect). The role determines the worker type, model, and system prompt.

**R4.2** A plan can mix roles across steps:
```yaml
steps:
  - title: Implement feature
    role: developer
  - title: Write integration tests
    role: tester
  - title: Update API docs
    role: developer
```

**R4.3** Testing as a step: the plan includes a `role: tester` step. The tester works on the same branch — runs tests, commits fixes if needed, calls `work_finish(pass/fail)`.

**R4.4** Testing as a phase (current `testPolicy`) continues to work for simple issues without plans. Planned issues with explicit tester steps skip the phase-level test.

### R5: Plan Creation

**R5.1** Plans can be created in three ways:

**Manual:** User writes the plan YAML in the issue body (or uses GitHub issue template).

**Tool:** A `plan_task` tool creates an issue with a plan:
```
plan_task({
  title: "Add OAuth authentication",
  steps: [
    { title: "Set up OAuth middleware", role: "developer" },
    { title: "Add login/callback endpoints", role: "developer" },
    { title: "Write integration tests", role: "tester" },
  ]
})
```

**Architect:** The architect role creates a plan as the output of `research_task`. Instead of creating independent issues via `task_create`, the architect writes a plan into a new issue.

**R5.2** Steps can be added or reordered while the issue is in a hold state (Planning, Refining). Active/done steps are locked.

### R6: PR Lifecycle (Standardized)

These behaviors apply to every code-producing issue — with or without a plan.

**R6.1** PR detection: `work_finish(done)` on the final step (or the only step) checks for a PR.

**R6.2** For planned issues, the PR is NOT created/reviewed after each step — only after all steps are done. Steps are commits; the PR wraps all of them.

**R6.3** Review policy per issue (via label): `review:human`, `review:agent`, `review:skip`. Per-project default via `reviewPolicy`.

**R6.4** Merge, conflict detection, changes requested, PR closed — all work as today, unchanged.

**R6.5** Changes requested after review: issue goes to To Improve, developer is dispatched without a plan (just fix the PR feedback). Plan steps are all "done" at this point.

### R7: Sub-Issues (Epics)

**R7.1** Sub-issues are for **independent work items that share a theme**, not for sequential steps within one feature.

**R7.2** Each sub-issue follows R1.1: own branch, own PR, own plan (optional).

**R7.3** Sub-issue ordering uses dependency gating (#443): sub-issue N+1 is blocked until sub-issue N is done. Implemented via labels (`blocked:dep`) or GitHub issue dependencies.

**R7.4** Sub-issue PRs can be stacked (sub-issue N's PR targets sub-issue N-1's branch) when sequential execution is needed.

**R7.5** Root epic issues are not directly dispatchable. They track progress across sub-issues. Auto-closed when all sub-issues reach terminal states.

**R7.6** Provider support:
- GitHub: sub-issues API (GraphQL) where available
- GitLab: work items hierarchy (GraphQL) where available
- Fallback: label-based linking (`epic:60`, `blocked:dep`)

### R8: Progress Tracking

**R8.1** For planned issues: the checklist in the issue body IS the progress view. Updated after each step.

**R8.2** For epics with sub-issues: the root issue body shows sub-issue status (auto-updated).

**R8.3** `task_list` and `project_status` show plans and epic hierarchies.

**R8.4** Notifications include step context: "Step 2/4 done" for planned issues, "Sub-issue 1/3 done" for epics.

### R9: Configuration

**R9.1** No new config keys for plans. Plan support is built-in — any issue with a `<!-- devclaw:plan -->` block in its body is a planned issue.

**R9.2** Existing config unchanged: `reviewPolicy`, `testPolicy`, `roleExecution`, `maxWorkersPerLevel`.

**R9.3** Per-issue overrides via labels: `review:human/agent/skip`, `test:skip`. Apply to the whole issue (all steps share the same PR).

---

## 4. State & Transition Reference

### State Types (unchanged)

| Type | Purpose | Dispatched? | Role required? |
|---|---|---|---|
| `queue` | Waiting for a worker | Yes (heartbeat) | Yes |
| `active` | Worker is executing | No | Yes |
| `hold` | Awaiting human decision | No | No |
| `terminal` | Completed | No | No |

### Default States

| State | Type | Role | Enters via | Exits via |
|---|---|---|---|---|
| Planning | hold | — | Initial, architect done | APPROVE → To Do / To Research |
| To Research | queue | architect | APPROVE from Planning | PICKUP → Researching |
| Researching | active | architect | PICKUP from To Research | COMPLETE → Done, BLOCKED → Refining |
| To Do | queue | developer | APPROVE from Planning/Refining | PICKUP → Doing |
| Doing | active | developer | PICKUP from To Do / To Improve | COMPLETE → To Review, BLOCKED → Refining |
| To Review | queue | reviewer | COMPLETE from Doing | PICKUP → Reviewing, APPROVED → merge + Done, SKIP → merge + Done |
| Reviewing | active | reviewer | PICKUP from To Review | APPROVE → merge + Done, REJECT → To Improve |
| To Test | queue | tester | APPROVED/APPROVE + merge | PICKUP → Testing, SKIP → Done |
| Testing | active | tester | PICKUP from To Test | PASS → Done, FAIL → To Improve, BLOCKED → Refining |
| To Improve | queue | developer | Changes requested, merge conflict, test fail | PICKUP → Doing |
| Refining | hold | — | BLOCKED from any active state | APPROVE → To Do |
| Done | terminal | — | Merged + closed, test passed, architect done | — |
| Rejected | terminal | — | PR closed without merge | — |

### How Roles Map to States

Each role "owns" specific queue/active state pairs:

| Role | Queue states | Active state | Completion results |
|---|---|---|---|
| developer | To Do, To Improve | Doing | done, blocked |
| reviewer | To Review | Reviewing | approve, reject, blocked |
| tester | To Test | Testing | pass, fail, refine, blocked |
| architect | To Research | Researching | done, blocked |

### Standardized Outcomes

These happen around code-producing steps regardless of workflow config:

| Outcome | Detection | Response | Automated? |
|---|---|---|---|
| PR created | `work_finish(done)` → `getPrStatus()` | Detect PR URL, transition to review | Yes |
| PR approved | Heartbeat polls `getPrStatus()` | Auto-merge, transition to Done/To Test | Yes |
| Changes requested | Heartbeat polls `getPrStatus()` | Transition to To Improve with feedback | Yes |
| Merge conflict | Heartbeat polls `mergeable` | Transition to To Improve with rebase task | Yes |
| PR closed (no merge) | Heartbeat polls `getPrStatus()` | Transition to Rejected, close issue | Yes |
| PR merged externally | Heartbeat polls `getPrStatus()` | Transition to Done, close issue | Yes |
| No PR found | `work_finish(done)` validation | Reject completion, tell developer to create PR | Yes |

---

## 5. How It All Maps Together

### Issue → State → Session → Branch → PR

```
ISSUE #51: Add OAuth authentication
│
├─ STATE LABELS (on the issue)
│   Planning → To Do → Doing → [step done, loop] → To Do → Doing → To Review → Done
│
├─ PLAN (in issue body)
│   step 1: OAuth middleware      [done]
│   step 2: Login endpoints       [active]  ← current dispatch
│   step 3: Integration tests     [pending]
│   step 4: API docs              [pending]
│
├─ BRANCH
│   feat/51-oauth-auth
│   ├─ commit: step 1 (OAuth middleware)
│   └─ commit: step 2 (login endpoints) ← worker commits here
│
├─ PR (created after step 1, grows with each step)
│   feat/51-oauth-auth → main
│   Status: draft (not ready for review until all steps done)
│
├─ SESSION
│   agent:devclaw-1:subagent:myapp-developer-senior-Ada
│   Same session reused across steps (same issue = feedback cycle)
│
├─ ROLE PROMPT (Layer 3)
│   devclaw/projects/myapp/prompts/developer.md
│   Injected via bootstrap hook on every turn
│
└─ TASK MESSAGE (Layer 4, rebuilt per step dispatch)
    "You are working on step 2 of 4: Add login/callback endpoints.
     Previous step (OAuth middleware) is done. Continue on branch feat/51-oauth-auth."
```

### Session Lifecycle

| Event | Session behavior |
|---|---|
| Step 1 dispatched | New session created (deterministic key based on project/role/level/slot) |
| Step 1 done | Session stays alive. Issue transitions To Do → Doing again for step 2 |
| Step 2 dispatched | **Same session reused** (same issue = same worker). Worker has context from step 1 |
| Step 2 done | Session stays alive |
| ... | Same pattern for all steps |
| All steps done → To Review | Session may be reused if review feedback returns issue to developer |
| PR merged → Done | Session available for next issue. Cleared if context budget exceeded |
| Different issue dispatched | Session reused if budget allows. Cleared if over budget |

**Key:** Steps within one issue always reuse the same session. The worker accumulates context across steps — it knows what it did in step 1 when working on step 2. This is already how feedback cycles work (same session for To Improve → Doing).

### What Happens on PR Feedback

```
All steps done → PR created → To Review → reviewer requests changes
                                                    ↓
                                              To Improve
                                                    ↓
                              Developer dispatched (same session, PR feedback in context)
                                                    ↓
                              Developer fixes, commits, calls work_finish(done)
                                                    ↓
                              Back to To Review (no plan steps involved — this is PR-level)
```

PR feedback is NOT a new step. It's the existing feedback cycle. The plan is already "all done" at this point. The developer just fixes the PR.

### Standalone Issue (no plan)

```
ISSUE #42: Fix login timeout
│
├─ STATE: To Do → Doing → To Review → Done
├─ BRANCH: fix/42-login-timeout
├─ PR: fix/42-login-timeout → main
├─ SESSION: new or reused from previous issue
├─ PLAN: none (no <!-- devclaw:plan --> in body)
└─ DISPATCH: single dispatch, no step tracking
```

Identical to current behavior. Zero changes needed.

### Epic with Sub-Issues

```
ISSUE #60: Overhaul authentication [epic label, not dispatched]
│
├─ ISSUE #61: Add OAuth provider
│   ├─ branch: feat/61-oauth
│   ├─ PR: feat/61-oauth → main
│   ├─ plan: [step 1, step 2, step 3]
│   └─ session: developer worker A
│
├─ ISSUE #62: Migrate password hashing (blocked until #61 done)
│   ├─ branch: feat/62-passwords
│   ├─ PR: feat/62-passwords → feat/61-oauth (stacked)
│   └─ session: developer worker A or B
│
└─ ISSUE #63: Update admin dashboard (blocked until #62 done)
    ├─ branch: feat/63-admin
    ├─ PR: feat/63-admin → feat/62-passwords (stacked)
    └─ session: developer worker
```

Each sub-issue is independent (own branch, own PR, own plan). Ordering enforced by dependency gating. PRs stack when sequential.

---

## 6. Implementation Phases

### Phase 1: Plan Parsing + Step Dispatch

Core plan support. No sub-issues, no stacking.

- [ ] Plan YAML parser (read/write `<!-- devclaw:plan -->` from issue body)
- [ ] Zod schema for plan validation
- [ ] Plan-aware queue scan in `tick.ts` — read plan, find next pending step
- [ ] Step-aware dispatch in `dispatch/index.ts` — include step context in task message
- [ ] Step-aware completion in `pipeline.ts` — update plan, loop or transition to review
- [ ] `plan_task` tool — create issue with plan in body
- [ ] Extend `task_list` to show step progress
- [ ] Unit tests with `TestProvider`

### Phase 2: Session Reuse + Step Context

Worker continuity across steps.

- [ ] Ensure session reuse across steps (same issue → same session key)
- [ ] Include previous step summary in task message
- [ ] Include branch state (exists/doesn't exist) in task message
- [ ] Draft PR creation after first code step (so subsequent steps have a visible PR)

### Phase 3: Sub-Issues + Dependency Gating (#443)

Epic support.

- [ ] Add `listSubIssues`, `getParentIssue`, `addSubIssue` to `IssueProvider`
- [ ] GitHub provider implementation (GraphQL with `sub_issues` header)
- [ ] GitLab provider implementation (WorkItem API)
- [ ] Dependency check in queue scanner — blocked sub-issues skipped
- [ ] Auto-close root issue when all sub-issues terminal
- [ ] Root issue progress tracking (auto-update body)

### Phase 4: PR Stacking + Polish

Stacked PRs for sequential sub-issues.

- [ ] Look up predecessor sub-issue's branch on dispatch
- [ ] Include base branch override in task message
- [ ] Hold merge until base is `main` (all predecessors merged)
- [ ] Handle conflict after retarget
- [ ] Enhanced notifications with step/epic context

---

## 7. Out of Scope (for now)

- **General cross-issue dependencies (#443 full scope)** — GitHub's `is blocked by` feature. Complementary to steps but a separate mechanism. Can be added later without changing the step model.
- **Custom workflow actions** — User-defined actions in transitions (deploy scripts, webhooks). Orthogonal to steps.
- **Cost tracking** — Token usage per step/issue. Useful but independent.
- **Progressive delegation** — Auto-promote workers based on pass rates. Independent of step model.
