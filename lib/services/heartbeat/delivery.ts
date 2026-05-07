import type { IssueProvider } from "../../providers/provider.js";
import type { RunCommand } from "../../context.js";
import {
  Action,
  StateType,
  WorkflowEvent,
  getCurrentCandidate,
  markCandidateStatus,
  type WorkflowConfig,
  type StateConfig,
} from "../../workflow/index.js";
import { detectStepRouting } from "../queue-scan.js";
import { log as auditLog } from "../../audit.js";

export async function deliveryPass(opts: {
  workspaceDir: string;
  projectName: string;
  workflow: WorkflowConfig;
  provider: IssueProvider;
  repoPath: string;
  runCommand: RunCommand;
}): Promise<number> {
  const { workspaceDir, projectName, workflow, provider } = opts;
  let transitions = 0;

  for (const [phase, step] of ([
    ["promotion", workflow.delivery?.promotion],
    ["acceptance", workflow.delivery?.acceptance],
  ] as const)) {
    const queueStateKey = step?.queueState;
    if (!queueStateKey) continue;
    const state = workflow.states[queueStateKey] as StateConfig | undefined;
    if (!state || state.type !== StateType.QUEUE) continue;
    const issues = await provider.listIssuesByLabel(state.label);

    for (const issue of issues) {
      const routing = detectStepRouting(issue.labels, phase);
      if (!routing) continue;

      const event = routing === "skip"
        ? WorkflowEvent.SKIP
        : phase === "promotion"
          ? WorkflowEvent.PROMOTED
          : WorkflowEvent.ACCEPTED;
      const transition = state.on?.[event];
      if (!transition) continue;

      if (routing === "human") {
        const candidate = await getCurrentCandidate(provider, issue.iid);
        const ready = phase === "promotion"
          ? candidate?.status === "active"
          : candidate?.status === "accepted";
        if (!ready) continue;
      }

      const targetKey = typeof transition === "string" ? transition : transition.target;
      const actions = typeof transition === "object" ? transition.actions : undefined;
      const targetState = workflow.states[targetKey];
      if (!targetState) continue;

      if (actions) {
        for (const action of actions) {
          switch (action) {
            case Action.CLOSE_ISSUE:
              await provider.closeIssue(issue.iid).catch(() => {});
              break;
            case Action.REOPEN_ISSUE:
              await provider.reopenIssue(issue.iid).catch(() => {});
              break;
          }
        }
      }

      if (phase === "acceptance" && routing === "skip") {
        await markCandidateStatus({ provider, issueId: issue.iid, status: "accepted", reason: "acceptance:skip" }).catch(() => {});
      }

      await provider.transitionLabel(issue.iid, state.label, targetState.label);
      await auditLog(workspaceDir, "delivery_transition", {
        project: projectName,
        issueId: issue.iid,
        phase,
        from: state.label,
        to: targetState.label,
        reason: `${phase}:${routing}`,
      });
      transitions++;
    }
  }

  return transitions;
}
