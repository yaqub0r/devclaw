import type { Project } from "../projects/index.js";
import type { RunCommand } from "../context.js";
import type { DeploymentConfig, DeploymentAction } from "../config/types.js";
import type { IssueProvider } from "../providers/provider.js";
import { getCurrentCandidate } from "../workflow/index.js";
import type { DeployCandidate, DeployDecision, DeployRequest } from "./types.js";

export function withLegacyDeploymentDefaults(config: DeploymentConfig, project: Project): DeploymentConfig {
  if ((config.transitions?.length ?? 0) > 0) return config;
  return {
    ...config,
    lanes: {
      default: {
        aliases: ["legacy", project.deployBranch || "deploy"],
        legacyBranch: project.deployBranch || undefined,
        legacyUrl: project.deployUrl || undefined,
      },
      ...(config.lanes ?? {}),
    },
    commands: {
      legacyDeploy: { run: `echo \"Legacy deploy ${"${CANDIDATE_REF}"} to ${"${TARGET_LANE}"} (${project.deployBranch || "unknown-branch"}) ${project.deployUrl || ""}\"` },
      legacyPromote: { run: `echo \"Legacy promote ${"${CANDIDATE_REF}"} to ${"${TARGET_LANE}"} (${project.deployBranch || "unknown-branch"}) ${project.deployUrl || ""}\"` },
      legacyAccept: { run: `echo \"Legacy accept ${"${CANDIDATE_REF}"} on ${"${TARGET_LANE}"}\"` },
      legacyRollback: { run: `echo \"Legacy rollback ${"${CANDIDATE_REF}"} to ${"${TARGET_LANE}"}\"` },
      ...(config.commands ?? {}),
    },
    evidenceProfiles: {
      legacy: { required: ["command", "candidate"], commentSummary: true },
      ...(config.evidenceProfiles ?? {}),
    },
    transitions: [
      { action: "deploy", to: "default", command: "legacyDeploy", evidence: "legacy" },
      { action: "promote", to: "default", command: "legacyPromote", evidence: "legacy" },
      { action: "accept", to: "default", command: "legacyAccept", evidence: "legacy" },
      { action: "rollback", to: "default", command: "legacyRollback", evidence: "legacy" },
      ...(config.transitions ?? []),
    ],
  };
}

export function resolveLaneAlias(config: DeploymentConfig, laneOrAlias: string | undefined): string | null {
  if (!laneOrAlias) return null;
  const normalized = laneOrAlias.trim().toLowerCase();
  for (const [lane, cfg] of Object.entries(config.lanes ?? {})) {
    if (lane.toLowerCase() === normalized) return lane;
    if ((cfg.aliases ?? []).some(alias => alias.trim().toLowerCase() === normalized)) return lane;
  }
  return null;
}

export function selectTransition(config: DeploymentConfig, action: DeploymentAction, sourceLane: string | null, targetLane: string) {
  const match = (config.transitions ?? []).find((transition) => transition.action === action && transition.to === targetLane && (transition.from == null || transition.from === sourceLane));
  if (!match) throw new Error(`No deployment transition configured for ${action} ${sourceLane ?? "*"} -> ${targetLane}`);
  return match;
}

export function validateRollbackLegality(config: DeploymentConfig, sourceLane: string | null, targetLane: string): void {
  if (!sourceLane) {
    throw new Error("Rollback requires sourceLane to identify the lane being rolled back from");
  }
  const allowed = config.lanes?.[sourceLane]?.rollbackTargets ?? [];
  if (allowed.length > 0 && !allowed.includes(targetLane)) {
    throw new Error(`Rollback from ${sourceLane} to ${targetLane} is not allowed by deployment config`);
  }
}

export function getEvidenceProfile(config: DeploymentConfig, profileName?: string): string[] {
  return config.evidenceProfiles?.[profileName ?? ""]?.required ?? [];
}

export async function normalizeCandidate(opts: {
  request: DeployRequest;
  config: DeploymentConfig;
  provider?: IssueProvider;
  repoPath: string;
  runCommand: RunCommand;
}): Promise<DeployCandidate | null> {
  const { request, config, provider, repoPath, runCommand } = opts;
  const sources = config.candidate?.sources ?? ["explicit", "issueCandidate", "issuePr", "gitHead"];

  for (const source of sources) {
    if (source === "explicit" && request.candidateRef) {
      return { ref: request.candidateRef, source: "explicit" };
    }
    if (source === "issueCandidate" && provider && request.issueId) {
      const current = await getCurrentCandidate(provider, request.issueId);
      if (current?.candidateId || current?.commitSha) {
        return {
          ref: current.candidateId ?? current.commitSha ?? "unknown-candidate",
          source: "issueCandidate",
          commitSha: current.commitSha,
          prUrl: current.prUrl,
        };
      }
    }
    if (source === "issuePr" && provider && request.issueId) {
      const pr = await provider.getPrStatus(request.issueId).catch(() => null);
      if (pr?.url) {
        return { ref: pr.sourceBranch ?? pr.url, source: "issuePr", prUrl: pr.url };
      }
    }
    if (source === "gitHead") {
      const head = await runCommand(["git", "rev-parse", "HEAD"], { cwd: repoPath, timeoutMs: 10_000 }).catch(() => null);
      const sha = head?.stdout?.trim();
      if (sha) return { ref: sha, source: "gitHead", commitSha: sha };
    }
  }

  return null;
}

export async function resolveDeployDecision(opts: {
  request: DeployRequest;
  config: DeploymentConfig;
  project: Project;
  provider?: IssueProvider;
  repoPath: string;
  runCommand: RunCommand;
}): Promise<DeployDecision> {
  const config = withLegacyDeploymentDefaults(opts.config, opts.project);
  const targetLane = resolveLaneAlias(config, opts.request.targetLane);
  if (!targetLane) throw new Error(`Unknown deployment lane: ${opts.request.targetLane}`);
  const sourceLane = resolveLaneAlias(config, opts.request.sourceLane) ?? null;

  if (opts.request.action === "rollback") validateRollbackLegality(config, sourceLane, targetLane);

  const policyLane = opts.request.action === "rollback" ? sourceLane ?? targetLane : targetLane;
  const laneCfg = policyLane ? config.lanes?.[policyLane] : undefined;
  if (laneCfg?.humanOnly || (laneCfg?.protected && config.policy?.requireHumanForProtectedLanes)) {
    if (opts.request.invocation.kind === "direct") {
      throw new Error(`Lane ${policyLane} is human-only for direct deploys`);
    }
  }

  if (opts.request.invocation.kind === "direct" && !opts.request.issueId && config.policy?.allowDirectWithoutIssue === false) {
    throw new Error("Direct deployment without an issue is disabled by policy");
  }

  const transition = selectTransition(config, opts.request.action, sourceLane, targetLane);
  const commandCfg = config.commands?.[transition.command];
  if (!commandCfg) throw new Error(`Deployment command ${transition.command} is not configured`);

  const candidate = await normalizeCandidate({
    request: opts.request,
    config,
    provider: opts.provider,
    repoPath: opts.repoPath,
    runCommand: opts.runCommand,
  });
  if ((transition.requireCandidate ?? true) && !candidate) {
    throw new Error("Deployment candidate identity is required but could not be resolved");
  }

  return {
    action: opts.request.action,
    sourceLane,
    targetLane,
    transitionKey: `${opts.request.action}:${sourceLane ?? "*"}->${targetLane}`,
    commandId: transition.command,
    command: commandCfg.run,
    cwd: commandCfg.cwd,
    timeoutMs: commandCfg.timeoutMs ?? 600_000,
    evidenceProfile: transition.evidence,
    candidate,
    issueLinkage: opts.request.issueLinkage ?? (opts.request.invocation.kind === "workflow" ? "workflow" : opts.request.issueId ? "comment" : "none"),
  };
}
