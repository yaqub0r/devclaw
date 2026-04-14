# GitHub Capability

This file defines the shared GitHub capability.

## Scope

Use this capability for repository inspection, issue creation, pull request work, code review support, git configuration checks, and authenticated GitHub operations.

## Shared rules

- Follow core capability canon in `CAPABILITIES.md`.
- Do not store GitHub secrets in repo files.
- Use identity-specific bindings to determine which GitHub persona, git config, and vault references apply.
- If an operation affects the user's public identity or public repos, honor approval rules from `CAPABILITIES.md`.

## Identity binding model

The GitHub capability is shared, but the acting identity is instance-specific.

Identity files should define GitHub bindings such as:
- actor/account name
- git author name
- git author email
- vault references for tokens or account lookup

The capability defines how GitHub work is done.
The identity file defines who performs it.
