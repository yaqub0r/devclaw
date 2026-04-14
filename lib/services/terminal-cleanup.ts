/**
 * Remove workflow residue when an issue reaches a terminal state.
 * Terminal issues should retain only their terminal state label plus durable metadata
 * like notify routing, not transient workflow-routing or worker-assignment labels.
 */
import type { IssueProvider } from "../providers/provider.js";
import { getAllLevels } from "../roles/index.js";
import { OWNER_LABEL_PREFIX, findStateByLabel, StateType, type WorkflowConfig } from "../workflow/index.js";

const WORKFLOW_STEP_PREFIXES = ["review:", "test:"];
const LEVELS = new Set(getAllLevels());

function isRoleLevelLabel(label: string): boolean {
  const parts = label.split(":");
  return parts.length >= 2 && LEVELS.has(parts[1]!.toLowerCase());
}

function isTransientWorkflowLabel(label: string): boolean {
  return WORKFLOW_STEP_PREFIXES.some((prefix) => label.startsWith(prefix)) ||
    label.startsWith(OWNER_LABEL_PREFIX) ||
    isRoleLevelLabel(label);
}

export async function cleanupTerminalWorkflowResidue(opts: {
  provider: Pick<IssueProvider, "getIssue" | "removeLabels">;
  workflow: WorkflowConfig;
  issueId: number;
}): Promise<string[]> {
  const { provider, workflow, issueId } = opts;
  const issue = await provider.getIssue(issueId);
  const state = issue.labels
    .map((label) => ({ label, state: findStateByLabel(workflow, label) }))
    .find((entry) => entry.state?.type === StateType.TERMINAL);

  if (!state) return [];

  const labelsToRemove = issue.labels.filter((label) => label !== state.label && isTransientWorkflowLabel(label));
  if (labelsToRemove.length > 0) {
    await provider.removeLabels(issueId, labelsToRemove);
  }
  return labelsToRemove;
}
