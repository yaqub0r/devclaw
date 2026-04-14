# Canon Watch

Canon Watch is a local review workflow for canon files only.

## Purpose

Detect changes to canon files without spending model tokens on polling.

Use a system cron job to run the checker locally. Only surface a chat approval request when unreviewed canon changes exist.

## Scope

Watch canon files only, as listed in `process/canon-watch.json`.

Do not use this for daily logs, raw memory notes, caches, or runtime state.

## Commands

Run checks:

```bash
python3 /home/sai/.openclaw/workspace/tools/canon_watch.py check
```

Show pending status:

```bash
python3 /home/sai/.openclaw/workspace/tools/canon_watch.py status
python3 /home/sai/.openclaw/workspace/tools/canon_watch.py summary
```

Accept a reviewed change:

```bash
python3 /home/sai/.openclaw/workspace/tools/canon_watch.py accept <path>
```

Reject a reviewed change and restore the tracked version:

```bash
python3 /home/sai/.openclaw/workspace/tools/canon_watch.py reject <path>
```

## State

Local state is stored under `state/canon-watch/` and should remain out of git.

Files:
- `snapshot.json` — last seen file fingerprints
- `pending.json` — review queue with status and diff snippets

## System cron recommendation

Example every 5 minutes:

```cron
*/5 * * * * cd /home/sai/.openclaw/workspace && /usr/bin/python3 /home/sai/.openclaw/workspace/tools/canon_watch.py check >/dev/null 2>&1
```

## Notification model

Preferred pattern:
1. system cron updates local pending state
2. assistant checks pending state when relevant
3. if pending canon changes exist, assistant sends one concise approval request in chat
4. user accepts or rejects
5. assistant runs the local accept/reject command

## Guardrail

Canon Watch exists to review canon drift, not to replace normal editing or git review.
