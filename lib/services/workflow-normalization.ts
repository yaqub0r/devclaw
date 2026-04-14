import { getStateLabels, type WorkflowConfig } from "../workflow/index.js";

export function staleWorkflowLabelsForTransition(
  labels: string[],
  toLabel: string,
  workflow: WorkflowConfig,
): string[] {
  const stateLabels = new Set(getStateLabels(workflow));
  const states = Object.values(workflow.states);
  const isHold = states.some((state) => state.label === toLabel && state.type === "hold");
  const isTerminal = states.some((state) => state.label === toLabel && state.type === "terminal");
  if (!isHold && !isTerminal) return [];

  return labels.filter((label) =>
    !stateLabels.has(label) && (
      label.startsWith("review:") ||
      label.startsWith("test:") ||
      label.startsWith("developer:") ||
      label.startsWith("tester:") ||
      label.startsWith("reviewer:") ||
      label.startsWith("architect:")
    ),
  );
}
