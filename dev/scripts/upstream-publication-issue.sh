#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Local helper for DevClaw upstream-publication tracking issues.

Title format:
  UP: #<local-issue> <short topic>

Usage:
  dev/scripts/upstream-publication-issue.sh title <local-issue> <short topic>
  dev/scripts/upstream-publication-issue.sh create <local-issue> <short topic> [gh issue create args...]
  dev/scripts/upstream-publication-issue.sh rename <tracking-issue> <local-issue> <short topic>

Examples:
  dev/scripts/upstream-publication-issue.sh title 117 no-PR developer operational tasks
  dev/scripts/upstream-publication-issue.sh create 117 no-PR developer operational tasks --body-file /tmp/body.md
  dev/scripts/upstream-publication-issue.sh rename 141 125/#130 silent-Refining fix family promotion prep

Notes:
- This is for local tracking in yaqub0r/devclaw, not upstream issue titles.
- Additional arguments after create are passed through to gh issue create.
EOF
}

if [ "$#" -lt 1 ]; then
  usage
  exit 1
fi

command="$1"
shift

build_title() {
  local local_issue="$1"
  shift
  if [ "$#" -eq 0 ]; then
    echo "error: short topic is required" >&2
    exit 1
  fi
  printf 'UP: #%s %s\n' "$local_issue" "$*"
}

case "$command" in
  title)
    if [ "$#" -lt 2 ]; then
      usage
      exit 1
    fi
    build_title "$@"
    ;;

  create)
    if [ "$#" -lt 2 ]; then
      usage
      exit 1
    fi
    local_issue="$1"
    shift

    topic_parts=()
    passthrough=()
    parsing_topic=1
    for arg in "$@"; do
      if [ "$parsing_topic" -eq 1 ] && [[ "$arg" == --* ]]; then
        parsing_topic=0
      fi
      if [ "$parsing_topic" -eq 1 ]; then
        topic_parts+=("$arg")
      else
        passthrough+=("$arg")
      fi
    done

    if [ "${#topic_parts[@]}" -eq 0 ]; then
      echo "error: short topic is required" >&2
      exit 1
    fi

    title="$(build_title "$local_issue" "${topic_parts[@]}")"
    gh issue create --title "$title" "${passthrough[@]}"
    ;;

  rename)
    if [ "$#" -lt 3 ]; then
      usage
      exit 1
    fi
    tracking_issue="$1"
    local_issue="$2"
    shift 2
    title="$(build_title "$local_issue" "$@")"
    gh issue edit "$tracking_issue" --title "$title"
    ;;

  -h|--help|help)
    usage
    ;;

  *)
    echo "error: unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
