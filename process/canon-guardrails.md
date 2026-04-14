# Canon Guardrails

Use these rules to prevent drift.

## Head file rule

If something is core canon for a domain, put it in the domain's head file.
Do not hide core canon in a subdirectory file.

## Capability rule

Shared capability behavior belongs in `CAPABILITIES.md`.
Detailed capability definitions belong in `capabilities/*.md`.
Identity-specific capability bindings do not belong in shared capability files.

## Identity binding rule

If a capability depends on who is acting, store the binding in the active identity canon or an identity-specific binding file.
Examples include git author identity, account selection, and vault references.

## Memory rule

Do not use `MEMORY.md` as a junk drawer for operating rules that should live in canon files.
Use memory for durable context, decisions, and lessons.

## Migration rule

When the user decides where a canon item belongs during discussion, move it immediately instead of leaving it as a conversational note.
