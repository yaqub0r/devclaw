# Repository Identity Requirement

## Requirement

Every repository-changing action must map:
- current group -> project -> repository

Rules:
- Every repository we commit to must have a project.
- Every project must have a canonical group string to match against the current chat/group.
- Agents are never permitted to make repository changes unless they are operating in the correct group for that project.
- A user request to touch a different repository from the wrong group does not override this rule.
- Agents must not search the workspace for a likely repository and operate on it from the wrong group context.
- This rule must hold across contexts, across agents, and across sub-agents.
