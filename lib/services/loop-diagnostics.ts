import { log as auditLog } from "../audit.js";

export type LoopDiagnosticData = Record<string, unknown>;

function isEnabled(): boolean {
  const raw = process.env.DEVCLAW_LOOP_DIAGNOSTICS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export async function recordLoopDiagnostic(
  workspaceDir: string,
  stage: string,
  data: LoopDiagnosticData,
): Promise<void> {
  if (!isEnabled()) return;
  await auditLog(workspaceDir, "loop_diagnostic", {
    stage,
    ...data,
  });
}
