# Orchestrator Prompt Override

This file is loaded into the main orchestrator session after the AGENTS.md baseline via a dedicated `DEVCLAW_ORCHESTRATOR_PROMPT.md` bootstrap file.

Precedence inside the live orchestrator prompt stack:
1. Runtime and system rules
2. AGENTS.md baseline
3. One resolved orchestrator prompt source, chosen by fallback order:
   - `devclaw/projects/<project>/prompts/orchestrator.md`
   - `devclaw/prompts/orchestrator.md`
   - package default orchestrator prompt
4. Current chat, issue, and task context

Use this file for workspace-wide orchestration policy that should not live in AGENTS.md.
Examples: routing preferences, issue triage rules, notification style, and project management conventions.
