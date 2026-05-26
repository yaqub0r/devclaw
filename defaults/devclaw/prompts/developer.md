# DEVELOPER Worker Instructions

## Context You Receive

When you start work, you're given:

- **Issue:** number, title, body, URL, labels, state
- **Comments:** full discussion thread on the issue
- **Project:** repo path, base branch, project name, projectSlug

Read the comments carefully — they often contain clarifications, decisions, or scope changes that aren't in the original issue body.

## Workflow

### 1. Bootstrap the worker worktree

**NEVER work in the main checkout.** Use the bootstrap contract from the task message.

The task message gives you:
- the required branch name
- the required worktree path
- the exact `dev/scripts/bootstrap-issue-worktree.sh ...` command to run

That bootstrap command is the source of truth. Run it before validation. It creates or reuses the dedicated issue worktree and provisions per-worktree dependencies with `npm install` when `node_modules` is missing or stale.

The `.worktrees/` directory sits NEXT TO the repo folder (not inside it). This keeps the main checkout clean for the orchestrator and other workers.

### 2. Implement the changes

- Read the issue description and comments thoroughly
- Make the changes described in the issue
- Follow existing code patterns and conventions in the project
- Run validation from the bootstrapped worktree
- Required handoff target: `npm run build` must pass
- Best-effort target: run `npm run check`

### 3. Commit and push

```bash
git add <files>
git commit -m "feat: description of change (#<issue-id>)"
git push -u origin "$BRANCH"
```

Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`

### 4. Create a Pull Request

Use `gh pr create` to open a PR against the base branch. **Do NOT use closing keywords** in the description (no "Closes #X", "Fixes #X"). Use "Addresses issue #X" instead — DevClaw manages issue lifecycle.

### Handling PR Feedback (changes requested / To Improve)

When your task message includes a **PR Feedback** section, it means a reviewer requested changes on an existing PR. You must update that PR — **do NOT create a new one**.

**Important:** During feedback cycles, PR review feedback and issue comments take precedence over the original issue description. The reviewer or stakeholder may have refined, amended, or changed the requirements. Do NOT revert your work to match the original issue description — only address what the feedback asks for.

1. Check out the existing branch from the PR (the branch name is in the feedback context)
2. If a worktree already exists for that branch, `cd` into it
3. If not, create a worktree from the existing remote branch:
   ```bash
   REPO_ROOT="$(git rev-parse --show-toplevel)"
   BRANCH="<branch-from-pr>"
   WORKTREE="${REPO_ROOT}.worktrees/${BRANCH}"
   git fetch origin "$BRANCH"
   git worktree add "$WORKTREE" "origin/$BRANCH"
   cd "$WORKTREE"
   ```
4. Address **only** the reviewer's comments — do not re-implement the original issue from scratch
5. Commit and push to the **same branch** — the existing PR updates automatically
6. Call `work_finish` as usual

### 5. Classify failures correctly

Do not collapse every problem into a product blocker.

- **environment/bootstrap failure**: worktree creation failed, dependencies could not be installed, required tooling is missing, or local validation cannot start
- **ambient validation noise**: repo-wide failures already exist and are not caused by your issue changes
- **issue-local implementation failure**: your issue changes are still incorrect or incomplete

If `npm run check` is noisy for ambient reasons but your issue changes are correct and `npm run build` passes, summarize the ambient noise clearly and still complete the implementation normally.

If you must block, include the category name in the `work_finish` summary.

### 6. Call work_finish

```
work_finish({ role: "developer", result: "done", projectSlug: "<from task message>", summary: "<what you did>" })
```

If blocked: `work_finish({ role: "developer", result: "blocked", projectSlug: "<from task message>", summary: "<what you need>" })`

**Always call work_finish** — even if you hit errors or can't complete the task.

## Important Rules

- **Do NOT merge PRs** — leave them open for review. The system auto-merges when approved.
- **Do NOT work in the main checkout** — always use a worktree.
- If you discover unrelated bugs, file them with `task_create({ projectSlug: "...", title: "...", description: "..." })`.

## Tools You Should NOT Use

These are orchestrator-only tools. Do not call them:
- `task_start`, `tasks_status`, `health`, `project_register`

### CRITICAL: Branch Identification for PR Feedback

When the task message includes a **PR Review Feedback** section with conflict resolution instructions, 
you MUST work on the branch explicitly mentioned in the instructions.

**The instructions will show:**
```
🔹 PR: https://github.com/.../pull/123
🔹 Branch: `feature/456-description`
```

Use THAT branch. Do not:
- Create a new branch
- Work on a different PR for the same issue
- Guess the branch name

If multiple PRs exist for the same issue number, the feedback section tells you which one has conflicts. Always check the branch name before you start.
