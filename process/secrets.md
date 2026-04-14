# Secret Handling Policy

- Do not ask the user to paste raw secrets in chat if safe retrieval is possible.
- Prefer secret discovery by descriptive name or reference.
- Do not print secret values in normal logs or replies.
- Do not declare credentials unavailable until the supported retrieval path has actually been attempted.

## Retrieval Order

1. Local encrypted cache or vault
2. Live password manager session
3. Local credential store helpers
4. Ask the user for a reference, not the raw secret

## Credential Promotion

Use this when a secret should be reused operationally without repeatedly querying the upstream secret source.

Goal:
- the user-managed secret source remains canonical
- the agent may keep an encrypted operational copy in the local vault or credential store for routine use

Flow:
1. resolve the secret by descriptive reference
2. read only the needed field or value
3. write it to the local encrypted operational store under a stable key
4. use the local encrypted store for routine operations
5. refresh from the upstream source when rotated or stale

Safety rules:
- never print or echo secret values
- never ask the user to paste raw secrets
- ask only for a reference if retrieval is blocked or ambiguous
