# Stagegates to Projects Conversation Parser

This helper script turns a long conversation or transcript into structured JSON for follow-up planning on the stagegates-to-projects conversion work.

## Script

`dev/scripts/parse-stagegates-conversation.mjs`

## Supported input formats

The script currently supports these transcript shapes:

1. **OpenClaw JSONL session transcripts**
   - Best option when the source conversation came from an OpenClaw session export.
   - The parser reads `message` events and keeps speaker roles and timestamps.

2. **Plain text / markdown transcripts**
   - Works with speaker-prefixed lines such as `user: ...` or `[timestamp] assistant: ...`.
   - Also handles looser text by grouping content into block messages.

Format selection can be explicit with `--format`, or automatic from file extension and content.

## Output shape

The parser emits a JSON document with four main sections:

- `meta`
  - input path, detected format, parse timestamp, message counts, role counts
- `messages`
  - normalized transcript messages with `role`, `timestamp`, `text`, and `source`
- `extracted`
  - detailed findings tied back to message indexes:
    - `decisions`
    - `actionItems`
    - `openQuestions`
    - `risks`
    - `stagegateProjectMappings`
    - `timeline`
- `highlights`
  - de-duplicated rollups intended for quick review

This covers the current open questions from issue #223 by giving us one output format that can support summarization, extraction, and mapping review.

## Usage

Parse a markdown transcript:

```bash
node dev/scripts/parse-stagegates-conversation.mjs \
  --input /path/to/conversation.md \
  --pretty \
  --output /tmp/stagegates-projects.json
```

Parse an OpenClaw JSONL transcript:

```bash
node dev/scripts/parse-stagegates-conversation.mjs \
  --input ~/.openclaw/agents/<agent>/sessions/<session>.jsonl \
  --format openclaw \
  --pretty
```

Pipe text through stdin:

```bash
cat /path/to/transcript.txt | \
  node dev/scripts/parse-stagegates-conversation.mjs --stdin --format markdown --pretty
```

## Current extraction behavior

The parser is intentionally heuristic, not LLM-based. It looks for:

- action-oriented language like `action item`, `todo`, `next step`, `need to`
- decision-oriented language like `decision`, `agreed`, `we will`
- open questions and uncertainty markers
- risk or blocker language
- explicit mapping phrases such as:
  - `stagegate alpha -> project onboarding`
  - `stagegate alpha becomes project onboarding`
  - `project onboarding replaces stagegate alpha`

## Validation

- Unit-style script tests: `npm run test:stagegates-parser`
- Regression fixture: `bash dev/regression/tests/stagegates-projects-parser-223.sh`

## Notes

- Mapping extraction is a first pass and should be reviewed by a human.
- If the incoming transcript shape changes, extend the format-specific parser instead of adding one-off regexes everywhere.
- If we later need richer summarization, this JSON output should be a stable intermediate format for a second processing step.
