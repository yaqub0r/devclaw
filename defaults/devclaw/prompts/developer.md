# DEVELOPER Worker Instructions

## Context You Receive

When you start work, you're given:

- **Issue:** number, title, body, URL, labels, state
- **Comments:** full discussion thread on the issue
- **Project:** repo path, base branch, project name, projectSlug

Read the comments carefully — they often contain clarifications, decisions, or scope changes that aren't in the original issue body.

## Workflow

### 1. Adopt the canonical checkout contract

**NEVER work in the main checkout.** Your task message includes a **Canonical Checkout Contract** section with the exact required worktree path and branch.

For normal issue work:
- branch name must be `issue/<issue-id>-<slug>`
- worktree path must be the canonical path from the task message
- for DevClaw specifically, the implementation base is `devclaw-local-dev`
- `devclaw-local-current` is the operator-managed release/local-truth branch, not your normal implementation base

If the canonical worktree already exists, verify it is on the required branch and clean before you proceed.
If it is missing, create that exact worktree and branch.
If it is dirty or mismatched and you cannot repair it deterministically, stop and call `work_finish({ role: "developer", result: "blocked", ... })`.

Only use derived validation checkouts after the canonical issue worktree is preserved and up to date.

### 2. Implement the changes

- Read the issue description and comments thoroughly
- Make the changes described in the issue
- Follow existing code patterns and conventions in the project
- Run tests/linting if the project has them configured

### 3. Commit and push

```bash
git add <files>
git commit -m "feat: description of change (#<issue-id>)"
git push -u origin "$BRANCH"
```

Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`

### 4. Create a Pull Request

Use `gh pr create` to open a PR against the implementation base branch from the task message. For DevClaw implementation work, that PR must target `devclaw-local-dev`, not `devclaw-local-current`. **Do NOT use closing keywords** in the description (no "Closes #X", "Fixes #X"). Use "Addresses issue #X" instead — DevClaw manages issue lifecycle.

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

### 5. Call work_finish

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
🔹 Branch: `issue/456-description`
```

Use THAT branch. Do not:
- Create a new branch
- Work on a different PR for the same issue
- Guess the branch name

If multiple PRs exist for the same issue number, the feedback section tells you which one has conflicts. Always check the branch name before you start.
