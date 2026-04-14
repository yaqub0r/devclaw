# Canon Tree

This workspace uses a pointer-based canon model.

## Principle

Top-level files are stable entrypoints.

If something is core canon for a domain, it belongs in the domain's head file, not in the subdirectory.

Use subdirectories for deeper detail, supporting material, and domain-specific expansion.

The goal is portability without stuffing every detail into startup files.

## Rule

There are two top-level canon patterns:

1. **Pointer head files** for domains where the active canonical content should live in one current target file.
2. **Head-file canon** for domains where core rules should be absorbed directly from the top-level file every time.

Examples:
- `IDENTITY.md` points to `identity/current.md`
- `SOUL.md` points to `soul/current.md`
- `USER.md` points to `user/current.md`
- `CAPABILITIES.md` contains core capability canon directly and indexes detailed files under `capabilities/`
- identity-specific capability bindings can live under `identity/` and be referenced by the active identity file

The active target or head file is the content that should be absorbed.

## Why

- keep startup context lean
- make the mind portable through git
- avoid brittle dependence on databases for core identity/policy/capabilities
- allow an instance to swap canon by updating one pointer file

## What belongs in git

Portable canon:
- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `USER.md`
- `CAPABILITIES.md`
- `identity/*.md`
- `soul/*.md`
- `user/*.md`
- `capabilities/*.md`
- `process/*.md`
- `MEMORY.md` when curated continuity should travel with the repo

## What stays out of git

Local and sensitive state:
- secrets
- API keys
- auth tokens
- vault contents
- browser profiles
- pairing/device auth material
- local databases with sensitive operational state
- caches, logs, and transient runtime files

## Recommended startup behavior

Read `AGENTS.md` first.

From there:
1. read the top-level pointer files required by startup
2. follow each pointer to its current canonical file
3. absorb the pointed file, not old alternates unless explicitly needed

## Pointer format

Use a simple human-readable format for pointer head files:

```md
# IDENTITY.md

This file is a pointer to the current canonical identity.

Current: `identity/current.md`
```

Use this pattern for `IDENTITY.md`, `SOUL.md`, and `USER.md`.

For head-file canon domains like `CAPABILITIES.md`, put core canon directly in the head file and use the subdirectory as an index target for deeper detail.

## Naming

Use stable canonical filenames when possible:
- `identity/current.md`
- `soul/current.md`
- `user/current.md`

If you want named variants, update only the pointer:
- `identity/akira.md`
- `soul/akira.md`

and set:
- `IDENTITY.md` -> `identity/akira.md`
- `SOUL.md` -> `soul/akira.md`

For `CAPABILITIES.md`, keep core canon in the head file and use `capabilities/*.md` for supporting detail.

For identity-sensitive capabilities, keep shared behavior in `capabilities/*.md` and keep actor/account/vault bindings in `identity/*.md` or an identity-specific binding file referenced by the active identity.

## Practical recommendation

Default to one active canonical file per domain.

Archive alternatives in the same subtree or move retired versions to `/home/sai/.openclaw_archive` when they should no longer be part of the active workspace.
