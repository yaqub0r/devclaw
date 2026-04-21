# Changelog

All notable changes to DevClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Critical:** work_finish now re-validates PR mergeable status during conflict resolution cycles, preventing infinite loops where developers claim "fixed" without pushing changes (#482, #480, #464, #483)
- **Workspace root file ownership boundary** — Startup now updates only DevClaw-managed tagged sections inside `AGENTS.md`, `HEARTBEAT.md`, and `TOOLS.md`, preserving user content outside those blocks while keeping explicit reset flows able to rewrite full defaults (#88)
- **Defaults loading in source/test runs** — Template resolution now finds `defaults/` correctly in both bundled and source layouts, restoring setup/workspace tests and local development flows

### Improved

- **Explicit branch name in conflict resolution instructions** — Conflict resolution feedback now includes the exact feature branch name and complete step-by-step checkout commands. Developers no longer need to infer the branch name from the PR URL, preventing confusion when multiple PRs exist for the same issue (#482, #484).

## [1.6.0] - 2026-02-23

### Added

- **Automatic workspace refresh on startup** — Every heartbeat startup refreshes workspace files (docs, prompts, workflow states) to the latest curated defaults. Role and timeout customizations in `workflow.yaml` are preserved. No manual tools needed — the mechanism is simple and reliable.
- **Attachment support** — Upload images and files to issues via Telegram, GitHub, and GitLab. Channel-agnostic attachment hook detects media in incoming messages and associates them with referenced issues (#397).
- **`task_attach` tool** — Attach files to issues programmatically from worker sessions.
- **`claim_ownership` tool** — Workers can claim ownership of tasks with deterministic name generation for identification.
- **Review skip policy** — Auto-merge PRs that match configurable skip criteria (e.g., auto-generated PRs, trivial changes) without requiring human review.
- **Test policy for automated testing** — Configurable test phase workflow with skip conditions and auto-transition rules.
- **Orphan scan with smart label revert** — Health check detects orphaned labels and reverts to the correct prior state based on PR status (merged, open, or none).
- **Closed issue detection in health checks** — Health pass detects issues that were closed externally and cleans up worker state accordingly.
- **Owner label auto-assignment** — Task modifications automatically assign an owner label for tracking (#421).
- **PR seen marking** — PRs are automatically marked as seen when detected by the heartbeat, preventing duplicate processing (#409).

### Changed

- **Worker names use unique-names-generator** — Replaced hardcoded name pool with the `unique-names-generator` library for more distinct, memorable worker names (#424).
- **Standardized worker name in notifications** — All task notifications consistently include worker name and level (#412, #416).
- **Enhanced feedback cycle task messages** — Feedback dispatches now prioritize PR review comments for clearer context to developers.
- **18 tools** (was 20) — removed `upgrade`, `reset_defaults`; workspace defaults are now refreshed automatically on every startup

### Fixed

- **Workflow actions for PR approval and skip states** — Corrected transition actions that were missing or misconfigured for approval and skip workflows.
- **To Do label color contrast** — Improved label color for better readability (#423).
- **GitHub attachment uploads** — Fixed `gh` CLI syntax for file uploads (#410).

### Removed

- **WELCOME.md** — Removed in favor of streamlined onboarding (#407).

## [1.5.1] - 2026-02-22

### Changed

- **esbuild bundler** — Build now produces a single `dist/index.js` with all dependencies (cockatiel, yaml, zod) inlined via esbuild. Eliminates the need for `npm install` at plugin install time; only the openclaw peer dependency is kept external.
- **Dependencies moved to devDependencies** — cockatiel, yaml, and zod are bundled at build time, so they no longer need to be installed as runtime dependencies.
- **Version injection at build time** — `PACKAGE_NAME` is now injected by esbuild defines instead of reading `package.json` at runtime, with a fallback for development/test environments.

## [1.5.0] - 2026-02-22

### Added

- **`sync_labels` tool** — Synchronize GitHub/GitLab labels with the current workflow config. Creates any missing state labels, role:level labels, and step routing labels from the resolved three-layer config. Use after editing `workflow.yaml` to push label changes to your issue tracker.
- **Slot-based worker pools** — Workers now support multiple concurrent slots per role level via `maxWorkers` / `maxWorkersPerLevel` in `workflow.yaml`. The dispatch engine, health checks, status dashboard, and project registration all support multi-slot workers.
- **PR closure handling** — Closing a PR without merging now transitions the issue to `Rejected` state with proper issue closure. New `PR_CLOSED` event in workflow transitions.
- **accountId support in notifications** — All `notify()` call sites now pass `accountId` and `runtime` for channel-aware notification routing.
- **PR_CLOSED event in review pass** — Heartbeat detects closed (unmerged) PRs in `To Review` and auto-transitions to `To Improve` for developer action.
- **Externalized defaults** — All built-in templates (AGENTS.md, HEARTBEAT.md, IDENTITY.md, TOOLS.md, workflow states, role prompts) moved to a `defaults/` directory. Workspace files are refreshed automatically on every startup.
- **Eyes marker (👀) on managed issues/PRs** — DevClaw adds an eyes marker to issue and PR bodies it manages, distinguishing them from legacy or manually-created items.
- **Comment consumption tracking with reactions** — Processed comments receive emoji reactions so workers don't re-read already-handled feedback on subsequent dispatches.
- **Auto-heal for context overflow** — Workers that hit context limits are automatically recovered and restarted instead of becoming zombies.
- **Session context budget management** — Smarter token budgeting prevents context overflow before it happens by tracking available budget.

### Changed

- **`projects.json` is pure runtime state** — All configuration moved to `workflow.yaml`; `projects.json` only tracks runtime worker state. Simplifies the config story.
- **Bootstrap hook replaces AGENTS.md injection** — Worker sessions now receive role-specific instructions via the `agent:bootstrap` hook instead of AGENTS.md file replacement.
- **Safe two-phase label transitions** — Label changes on GitHub/GitLab use a two-phase commit (add new → remove old) to prevent half-states on API failures.
- **PR review detection improvements** — More reliable detection of review approvals, change requests, and conversation comments across GitHub and GitLab providers.
- **TOOLS.md template improvements** — Cleaner generated tool documentation for new workspaces.
- **16 tools** (was 14) — added `tasks_status`, `task_list`, `sync_labels` (replaced `status` and `work_heartbeat`)

### Fixed

- **Architect prompt** — Enforces single comprehensive task with checklist format instead of multiple small tasks.
- **GitHub PR comment emoji marking** — Fixed consumption tracking for PR review comments.
- **PR state property** — `findPrsViaTimeline` now returns `state` property; `getPrStatus` distinguishes closed-PR from no-PR.
- **Workflow.yaml comments** — Corrected comments and formatting for clarity.

### Removed

- **Orphaned session scan** — Removed from health and heartbeat services (was causing false positives).

## [1.3.6] - 2026-02-18

### Added

- **Heartbeat starts immediately** — No restart needed after onboarding; the scheduler begins on first project registration.
- **`tasks_status` tool** — Full project dashboard showing issues waiting for input (hold), work in progress (active), and queued for work (queue).
- **`task_list` tool** — Browse and filter issues by workflow state with text search.
- **PR validation on `work_finish`** — Developers must have a valid PR before completing; catches missing PRs early.
- **Blocked result support** — All worker roles can now report "blocked" to return tasks to the queue with context about what they need.
- **Label colors for GitLab** — Pipeline labels get color-coded on GitLab for visual distinction.

### Fixed

- **PR state detection improvements** — Better handling of draft PRs, merge conflicts, and cross-fork PRs.

## [1.3.5] - 2026-02-17

### Added

- **LLM-powered model autoconfiguration** — `autoconfigure_models` uses an LLM to intelligently assign available models to role tiers based on capability analysis.
- **Registry default fallback** — When specific models aren't available, falls back to sensible defaults from the model registry.

### Changed

- **Improved onboarding flow** — Streamlined setup with clearer prompts and automatic model detection.

## [1.3.0] - 2026-02-17

### Changed — Default Workflow

The out-of-box experience is now **human review with no test phase**. Previously, the default workflow used `reviewPolicy: auto` and included a full test phase (`toTest → testing → done`). The new default is simpler and matches how most teams start:

```
Planning → To Do → Doing → To Review → PR approved → Done (auto-merge + close)
```

- **Review policy** changed from `auto` to `human` — all PRs require human approval on GitHub/GitLab
- **Test phase** (toTest/testing states) removed from defaults — enable it in `workflow.yaml` when ready
- **Heartbeat auto-merge** — polls PR status, auto-merges on approval, auto-dispatches DEV fix on changes requested or merge conflict
- **`CHANGES_REQUESTED`** and **`MERGE_CONFLICT`** events added to `toReview` transitions (previously missing)

The test phase is documented as a commented-out section in `workflow.yaml` with step-by-step enablement instructions.

### Added

- **`workflow_guide` tool** — Zero-side-effect informational tool that returns comprehensive `workflow.yaml` configuration documentation for the LLM. Marks every field as FIXED (enum), FREE-FORM, or extendable. Optional `topic` parameter narrows to a specific section: overview, states, roles, review, testing, timeouts, overrides. Call this before editing workflow.yaml.
- **`autoconfigure_models` tool** — LLM-powered model selection based on available models
- **`task_edit_body` tool** — Edit issue title/description (initial state only; audit-logged)
- **Architect role** — New role for design investigations. `research_task` creates a Planning issue with rich context and dispatches an architect worker directly. Architect posts findings as comments, completes with `done` (stays in Planning) or `blocked` (→ Refining). Levels: junior (Sonnet), senior (Opus).
- **Reviewer role** — Dedicated code review role with junior (Sonnet) and senior (Opus) levels. Used when `reviewPolicy` is `agent` or `auto`.
- **Dynamic role registry** — Roles are no longer hardcoded. `ROLE_REGISTRY` in `lib/roles/registry.ts` defines all roles with configurable levels, models, emoji, and completion results. Adding a new role means one registry entry.
- **Configurable workflow state machine** — Issue lifecycle is now a state machine defined in `workflow.yaml` with typed states (`queue`, `active`, `hold`, `terminal`), transitions with actions (`gitPull`, `detectPr`, `mergePr`, `closeIssue`, `reopenIssue`), and review checks.
- **Three-layer configuration** — Config resolution: built-in defaults → workspace `workflow.yaml` → project `workflow.yaml`. Validated at load time with Zod schemas. Integrity checks verify transition targets exist.
- **Provider resilience** — All issue tracker calls wrapped with cockatiel retry (3 attempts, exponential backoff) and circuit breaker (opens after 5 failures, half-opens after 30s).
- **Bootstrap hook for role instructions** — Worker sessions receive role-specific instructions via `agent:bootstrap` hook at session startup. Reads from `devclaw/projects/<project>/prompts/<role>.md`, falls back to `devclaw/prompts/<role>.md`.
- **PR feedback loop** — Heartbeat detects PR comments with review feedback, transitions to `To Improve`, and dispatches DEV with the feedback context. Reacts with 👀 emoji to processed comments.
- **PR context in dispatch** — Workers receive PR URL, diff stats, and review comments when dispatched for fixes.
- **Git history fallback** — Review transitions work even when no PR exists (falls back to git log analysis).
- **Active workflow in status** — `status` tool response includes `activeWorkflow` object (reviewPolicy, testPhase, stateFlow, hint).
- **Active workflow in project_register** — Registration response includes active workflow config with customization hint.
- **Onboarding workflow overview** — Onboarding flow now includes a step explaining the active workflow and how to customize it.
- **Multi-group isolation** — `notify:{groupId}` labels for project-specific notifications.
- **Project-first schema** — `projects.json` restructured with project as the top-level key, channels nested within. Automatic migration from old schema.
- **Orphaned session cleanup** — Health pass detects and cleans up subagent sessions that no longer match any active worker.
- **Immediate startup tick** — Heartbeat runs first tick 2s after service startup instead of waiting for the full interval.
- **GitHub timeline API** — Uses timeline API to find linked PRs for more reliable PR detection.
- **Inline markdown links** — All notifications use inline markdown links instead of bare URLs.
- **Telegram link preview control** — Notifications disable link previews by default; configurable via `linkPreview` setting.

### Fixed

- **PR comment detection** — `hasConversationComments` in both GitHub and GitLab providers now correctly filters by 👀 reaction instead of using invalid "robot" emoji.
- **Duplicate links in announcements** — Removed duplicate issue/PR links from orchestrator announcement guidance.
- **PR-issue linking regex** — Fixed regex pattern for GitHub provider PR-issue linking.
- **Self-merged PR bypass** — Prevented self-merged PRs from bypassing the `review:human` gate.
- **Health check false-kills** — Fixed health pass incorrectly killing workers due to session cap check and wrong revert label.
- **GitLab approval detection** — Removed unreliable GitLab MR approval detection; relies on merge status instead.
- **Heartbeat auto-merge scope** — Only auto-merges PRs with explicit `review:human` label.
- **Project lookup** — All tick/heartbeat paths use `getProject()` for proper slug/groupId resolution.

### Changed

- **14 tools** (was 11) — added `workflow_guide`, `autoconfigure_models`, `task_edit_body`, `research_task`
- **4 roles** (was 2) — developer, tester, architect, reviewer
- **10 default states** (was 12) — removed toTest/testing from defaults
- Project identification changed from group IDs to project slugs across all tools
- `design_task` renamed to `research_task`
- QA role renamed to Tester
- Level names standardized: junior/medior/senior across all roles (architect uses junior/senior)
- Workspace data directory moved from `<workspace>/projects/` to `<workspace>/devclaw/` (automatic migration)
- All documentation updated for consistency with new defaults

---

## [1.1.0] - 2026-02-13

### Security

- **Eliminated all `child_process` imports** — Migrated 9 files from `node:child_process` (`execFile`, `execSync`, `spawn`) to the plugin SDK's `api.runtime.system.runCommandWithTimeout` via a shared `runCommand()` wrapper. The OpenClaw plugin security scanner no longer flags any warnings during installation.

### Added

- **`lib/run-command.ts`** — New thin wrapper module that stores the plugin SDK's `runCommandWithTimeout` once during `register()`, making it available to all modules without threading the API object through every function.
- **Session fallback mechanism** — `ensureSession()` now validates stored session keys against the current agent ID and verifies sessions still exist before reuse. Stale, mismatched, or deleted sessions are automatically recreated instead of failing silently.
- **Default workspace discovery** — The heartbeat service now scans `agents.defaults.workspace` in addition to `agents.list`, so projects in the default workspace are discovered automatically without explicit agent registration.
- **Heartbeat tick notifications** — Heartbeat pickups now send workerStart notifications to project groups via the notify system.
- **Agent instructions file** — Added `AGENTS.md` with project structure, conventions, and testing workflow.

### Fixed

- **Heartbeat agent ID** — Default workspace agents now use `agentId: "main"` instead of `"default"`, matching OpenClaw's actual routing. Previously caused `agent "main" does not match session key agent "default"` errors that left workers stuck as active on ghost sessions.
- **Heartbeat config access** — `discoverAgents()` now reads from `api.config` instead of `ctx.config` (service context), which didn't include `agents.defaults`.
- **Session key always persisted** — `recordWorkerState()` now always stores the session key, not just on spawn. This ensures send-to-spawn fallbacks update `projects.json` with the corrected key.
- **GitLab/GitHub temp file elimination** — `createIssue()` and `addComment()` in both providers now pass descriptions/comments directly as argv instead of writing temp files and using shell interpolation (`$(cat ...)`). Safer and simpler.

### Changed

- `createProvider()` is now async (callers updated across 12 files)
- `fetchModels()` / `fetchAuthenticatedModels()` are now async
- `resolveProvider()` is now async

---

## [1.0.0] - 2026-02-12

### 🎉 First Official Launch

DevClaw is now production-ready! Turn any group chat into a dev team that ships.

This is the first stable release of DevClaw, a plugin for [OpenClaw](https://openclaw.ai) that transforms your orchestrator agent into a development manager. It hires developers, assigns tasks, reviews code, and keeps the pipeline moving — across as many projects as you have group chats.

### ✨ Core Features

#### Multi-Project Development Pipeline

- **Autonomous scheduling engine** — `work_heartbeat` continuously scans queues, dispatches workers, and drives DEV → QA → DEV feedback loops with zero LLM tokens
- **Project isolation** — Each project has its own queue, workers, sessions, and state
- **Parallel execution** — DEV and QA work simultaneously within projects, multiple projects run concurrently

#### Intelligent Developer Assignment

- **Tier-based model selection** — Junior (Haiku) for simple fixes, Medior (Sonnet) for features, Senior (Opus) for architecture
- **Automatic complexity evaluation** — Orchestrator analyzes tasks and assigns appropriate developer level
- **Session reuse** — Workers accumulate codebase knowledge across tasks, reducing token usage by 40-60%

#### Process Enforcement

- **GitHub/GitLab integration** — Issues are the single source of truth, not an internal database
- **Atomic operations** — Label transitions, state updates, and session dispatch happen atomically with rollback on failure
- **Tool-based guardrails** — 11 tools enforce the development process deterministically

#### Token Efficiency

- **~60-80% token savings** through tier selection, session reuse, and token-free scheduling
- **No reasoning overhead** — Plugin handles orchestration mechanics, agent provides intent only

### 🚀 Recent Improvements

#### Added

- **LLM-powered model auto-configuration** — Intelligent model selection based on task complexity
- **Enhanced onboarding experience** — Model access verification and Telegram group guidance
- **Orchestrator role enforcement** — Clear separation between planning (orchestrator) and implementation (workers)
- **Role-specific instructions** — Per-project, per-role instruction files injected at dispatch time
- **Automatic log truncation** — Maintains last 250 audit log entries for manageable file sizes
- **Comprehensive documentation** — Architecture, tools reference, configuration guide, QA workflow, and more

#### Fixed

- **TypeScript build configuration** — Fixed module resolution for proper openclaw plugin-sdk type imports
- **Worker health monitoring** — Detects and recovers from crashed or stale worker sessions
- **Label transition atomicity** — Clean state management prevents orphaned labels
- **Session persistence** — Workers properly maintain context between tasks

### 📚 Documentation

Comprehensive documentation available in the `docs/` directory:

- [Architecture](docs/ARCHITECTURE.md) — System design and data flow
- [Tools Reference](docs/TOOLS.md) — All 16 tools with parameters
- [Configuration](docs/CONFIGURATION.md) — Roles, timeouts, `openclaw.json`, `projects.json`
- [Workflow](docs/WORKFLOW.md) — State machine, review policies, test phase
- [Onboarding Guide](docs/ONBOARDING.md) — Step-by-step setup
- [Management Theory](docs/MANAGEMENT.md) — Design philosophy

### 🔧 Installation

```bash
openclaw plugins install @laurentenhoor/devclaw
```

Then start onboarding:

```bash
openclaw chat "Hey, can you help me set up DevClaw?"
```

### 📦 Requirements

- OpenClaw >= 2026.0.0
- Node.js >= 20
- `gh` CLI (GitHub) or `glab` CLI (GitLab), authenticated

---

## [0.1.1] - 2026-01-XX

### Fixed

- Correct npm package entry point and include manifest file
- Update installation commands to reflect new package name

---

## [0.1.0] - 2026-01-XX

### Added

- Initial npm publishing infrastructure
- Core plugin functionality
- Work heartbeat service for autonomous scheduling
- Multi-project support with isolated state
- Developer tier system (Junior/Medior/Senior)
- QA workflow with Reviewer/Tester roles
- 11 tools for task and workflow management
- GitHub and GitLab issue provider integration
- Session reuse and context accumulation
- Audit logging system

---

[1.6.0]: https://github.com/laurentenhoor/devclaw/compare/v1.5.2...v1.6.0
[1.5.1]: https://github.com/laurentenhoor/devclaw/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/laurentenhoor/devclaw/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/laurentenhoor/devclaw/compare/v1.3.6...v1.4.0
[1.3.6]: https://github.com/laurentenhoor/devclaw/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/laurentenhoor/devclaw/compare/v1.3.4...v1.3.5
[1.3.0]: https://github.com/laurentenhoor/devclaw/compare/v1.2.2...v1.3.0
[1.1.0]: https://github.com/laurentenhoor/devclaw/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/laurentenhoor/devclaw/compare/v0.1.1...v1.0.0
[0.1.1]: https://github.com/laurentenhoor/devclaw/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/laurentenhoor/devclaw/releases/tag/v0.1.0
