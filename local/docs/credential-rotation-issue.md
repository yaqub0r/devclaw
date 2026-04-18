# Issue: Rotate exposed credentials after local vault tooling leak

## Summary

A local vault verification step printed secret values into tool output during setup. Treat any credential revealed by that output as compromised.

## Credentials to rotate

- GitHub PAT stored under local vault key `lastpass.github.pat`
- GitHub-related secret stored under local vault key `lastpass.github.account`
  - verify what this credential is before reusing it
  - rotate if it is still active and security-relevant

## What happened

- The local vault was created and synced from LastPass
- A verification command used `vault.py read`
- At that time, `vault.py read` printed decrypted values directly
- That output exposed secret material in tool output

## Remediation

1. Rotate the exposed GitHub PAT immediately
2. Audit the `github.account` secret and rotate if applicable
3. Update LastPass with replacement values
4. Re-sync the local vault from LastPass
5. Confirm the vault tooling only returns redacted output by default

## Tooling fix

- `tools/unseal-page/vault.py`
  - `read` now redacts secret string values by default
  - `dump-unsafe` is the only explicit raw-output path and should be treated as break-glass only

## Follow-up

- review other secret tools for accidental stdout disclosure
- avoid verifying secret presence by printing decrypted payloads
- prefer key listings, metadata, or redacted reads
