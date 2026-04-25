import { log as auditLog } from "../audit.js";

export type LoopDiagnosticData = Record<string, unknown>;

const ALWAYS_ON_STAGES = new Set([
  "dispatch_pickup",
  "loop_brake_evaluation",
  "loop_brake_halt",
  "pipeline_detect_pr",
  "pipeline_detect_pr_error",
  "work_finish_execute_start",
  "work_finish_pr_validation",
  "work_finish_pr_missing",
  "work_finish_conflict_cycle_check",
  "work_finish_conflict_rejected",
  "work_finish_conflict_verified",
  "work_finish_transition_planned",
  "work_finish_transition",
  "review_pr_status",
  "review_feedback_transition_planned",
  "review_feedback_transition",
  "health_orphan_detected",
  "health_requeue",
  "health_requeue_failed",
]);

function getRawFlag(): string | undefined {
  return process.env.DEVCLAW_LOOP_DIAGNOSTICS?.trim();
}

function isEnabled(): boolean {
  const raw = getRawFlag()?.toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function shouldRecordStage(stage: string): boolean {
  return isEnabled() || ALWAYS_ON_STAGES.has(stage);
}

export async function recordLoopDiagnostic(
  workspaceDir: string,
  stage: string,
  data: LoopDiagnosticData,
): Promise<void> {
  if (!shouldRecordStage(stage)) return;
  await auditLog(workspaceDir, "loop_diagnostic", {
    stage,
    loopDiagnosticsEnabled: isEnabled(),
    loopDiagnosticsFlag: getRawFlag() ?? null,
    alwaysOnStage: ALWAYS_ON_STAGES.has(stage),
    ...data,
  });
}
