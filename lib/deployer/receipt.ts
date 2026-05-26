import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { log as auditLog } from "../audit.js";
import type { DeployReceipt } from "./types.js";

function getDeployReceiptPath(workspaceDir: string, projectName: string, receipt: DeployReceipt): string {
  return join(workspaceDir, DATA_DIR, "deploy", projectName, `${receipt.timestamp.replace(/[:.]/g, "-")}-${receipt.id}.json`);
}

export async function writeDeployReceipt(workspaceDir: string, projectName: string, receipt: DeployReceipt): Promise<string> {
  const dir = join(workspaceDir, DATA_DIR, "deploy", projectName);
  await mkdir(dir, { recursive: true });
  const filePath = getDeployReceiptPath(workspaceDir, projectName, receipt);
  await writeFile(filePath, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
  await auditLog(workspaceDir, "deploy_receipt", {
    project: projectName,
    issueId: receipt.issueId ?? null,
    receiptId: receipt.id,
    action: receipt.action,
    targetLane: receipt.targetLane,
    sourceLane: receipt.sourceLane,
    success: receipt.success,
    receiptPath: filePath,
    invocation: receipt.invocation.kind,
    linkedIssueCommentId: receipt.linkedIssueCommentId ?? null,
  });
  return filePath;
}

export async function updateDeployReceipt(workspaceDir: string, projectName: string, receipt: DeployReceipt): Promise<string> {
  const filePath = receipt.receiptPath ?? getDeployReceiptPath(workspaceDir, projectName, receipt);
  await writeFile(filePath, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
  return filePath;
}

export function renderDeployReceiptSummary(receipt: DeployReceipt): string {
  const lines = [
    "## DevClaw Deploy Receipt",
    "",
    `- receipt: ${receipt.id}`,
    `- action: ${receipt.action}`,
    `- transition: ${receipt.sourceLane ?? "*"} -> ${receipt.targetLane}`,
    `- candidate: ${receipt.candidate?.ref ?? "none"}`,
    `- invocation: ${receipt.invocation.kind}`,
    `- linkage: ${receipt.issueLinkage}`,
    `- result: ${receipt.success ? "success" : "failed"}`,
  ];
  if (receipt.receiptPath) lines.push(`- receiptPath: ${receipt.receiptPath}`);
  if (receipt.stdout.trim()) lines.push(`- stdout: \`${receipt.stdout.trim().slice(0, 200)}\``);
  if (receipt.stderr.trim()) lines.push(`- stderr: \`${receipt.stderr.trim().slice(0, 200)}\``);
  return lines.join("\n");
}
