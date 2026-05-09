# Release agent contract

This document describes the intended operator-facing contract for the DevClaw release agent.

It is a design target for the next implementation pass. The current codebase already supports delivery-phase hooks such as `To Promote`, `Promoting`, `To Accept`, and `Accepting`, but it does not yet fully implement the contract below.

## Core idea

Release is a distinct process from implementation, review, and testing.

- Development answers: was the change built correctly?
- Review answers: is the code acceptable?
- Testing answers: does it behave technically as expected?
- Release answers: should this exact candidate move from one lane to another, and can we prove that it did?

Release initiation should be **policy-controlled**, not automatic. Like PR handling, it may be human-initiated or agent-initiated depending on project policy.

## Flow

```mermaid
flowchart TD
  A[Candidate ready in source lane] --> B{Human initiates promotion?}
  B -- no --> A
  B -- yes --> C[Promote candidate from source lane to target lane]
  C --> D[Record candidate identity and promotion receipt]
  D --> E[Run lane-specific verification]
  E --> F{Acceptance decision}
  F -- accept --> G[Record acceptance receipt]
  G --> H[Candidate accepted in target lane]
  F -- reject --> I[Invalidate candidate]
  I --> J[Demotion or rollback path]
  F -- refine --> K[Return to refinement or improvement]
  F -- blocked --> L[Pause for human decision]
```

## Required concepts

### 1. Lanes are project-defined

Projects should define release lanes or environments structurally in config.

Examples might be `dev`, `staging`, `production`, `local-current`, or something project-specific, but DevClaw core should not hardcode those names.

### 2. Promotion is source to target

Promotion should mean moving an exact candidate from one named lane to another named lane.

A promotion request should at minimum identify:
- the candidate
- the source lane
- the target lane
- the promotion policy or type

### 3. Candidate identity is mandatory

A promoted candidate must be tied to an exact identity, such as:
- commit SHA
- PR URL
- branch
- tag, version, build id, or artifact id when relevant

### 4. Proof of release is mandatory

The release agent must prove that it released the intended version.

Minimum proof should include:
- source candidate identity
- source lane
- target lane
- resulting target identity or target state
- verification evidence that the destination matches the intended candidate

Core rule:

> Prove source identity, prove destination identity, prove they match the intended promotion.

### 5. Acceptance is candidate-specific

Acceptance should apply to a specific promoted candidate, not the issue in general.

Acceptance should record:
- who accepted it
- where it was accepted
- what evidence was used
- what exact candidate was accepted

### 6. Acceptance defaults should be strong but configurable

Suggested default acceptance criteria:
- candidate identity present
- source lane and target lane recorded
- proof of target state present
- required checks or evidence attached
- accepter identity recorded
- explicit outcome recorded

Projects should be able to override:
- who can accept
- required evidence
- required checks
- allowed outcomes
- per-lane rules

### 7. Acceptance outcomes should be explicit

Suggested standard outcomes:
- `accept`
- `reject`
- `refine`
- `blocked`

Rejecting acceptance should invalidate the candidate, not just vaguely reopen the issue.

### 8. Rollback and demotion must be explicit

If a promoted candidate fails acceptance or later validation, the system should explicitly mark it invalid and record the demotion or rollback path.

### 9. Preconditions and repeat behavior must be defined

The contract should define:
- what must already be true before promotion is allowed
- what should happen on repeated promotion attempts
  - no-op
  - retry
  - replace candidate
  - require explicit override

## Config versus prompts

This contract should live primarily in project config and workflow semantics, not only in prompts.

Prompts can explain how a project uses the release agent, but they should not be the sole source of truth for:
- lane names
- allowed promotion paths
- acceptance authority
- required evidence
- lane-specific rules

## Current implementation status

Current DevClaw already provides:
- delivery phases for promotion and acceptance
- routing policies `human`, `agent`, and `skip`
- candidate provenance comments
- role-aware validation for promotion and acceptance states

Current DevClaw does not yet fully provide:
- operator-defined lanes or environments in config
- source to target promotion semantics
- human-initiation UX as a first-class release start rule
- a strong proof-of-release schema
- shared default acceptance criteria with easy per-project overrides
- documented retry and idempotency behavior

## Relationship to existing issues

- `#216` root delivery-phase effort
- `#217` architect design guidance
- `#218` first-class delivery-phase implementation
- `#232` release-agent contract definition
