#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <repo-root> <issue-id> <issue-title> <base-branch> [branch-name]" >&2
  exit 2
fi

REPO_ROOT="$1"
ISSUE_ID="$2"
ISSUE_TITLE="$3"
BASE_BRANCH="$4"
BRANCH_NAME="${5:-}"

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/(.{48}).*/\1/'
}

if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME="issue/${ISSUE_ID}-$(slugify "$ISSUE_TITLE")"
fi

WORKTREE="${REPO_ROOT}.worktrees/${BRANCH_NAME}"
LOCKFILE="${WORKTREE}/package-lock.json"
NODE_MODULES="${WORKTREE}/node_modules"

mkdir -p "$(dirname "$WORKTREE")"

git -C "$REPO_ROOT" fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || true

if [[ -d "$WORKTREE/.git" || -f "$WORKTREE/.git" ]]; then
  :
elif git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git -C "$REPO_ROOT" worktree add "$WORKTREE" "$BRANCH_NAME"
else
  git -C "$REPO_ROOT" worktree add "$WORKTREE" -b "$BRANCH_NAME" "$BASE_BRANCH"
fi

cd "$WORKTREE"

if [[ ! -d "$NODE_MODULES" || ( -f "$LOCKFILE" && "$LOCKFILE" -nt "$NODE_MODULES" ) || package.json -nt "$NODE_MODULES" ]]; then
  npm install
fi

printf 'BOOTSTRAPPED_WORKTREE=%s\n' "$WORKTREE"
printf 'BOOTSTRAPPED_BRANCH=%s\n' "$BRANCH_NAME"
