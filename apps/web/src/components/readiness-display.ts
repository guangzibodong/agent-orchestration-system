import type { ReadinessCheck, ReadinessResponse } from "@mawo/shared";

export type ReadinessSeverity = "healthy" | "warning" | "danger" | "neutral";

export type ReadinessSummary = {
  statusLabel: string;
  severity: ReadinessSeverity;
  deploymentLabel: string;
  protectedByTokenLabel: string;
  activeJobsLabel: string;
  blockedChecks: number;
  degradedChecks: number;
  readyChecks: number;
  totalChecks: number;
};

export type ReadinessCheckDisplay = {
  id: string;
  label: string;
  statusLabel: string;
  severity: ReadinessSeverity;
  detail: string;
};

const statusLabels: Record<ReadinessCheck["status"], string> = {
  ready: "Ready",
  degraded: "Degraded",
  blocked: "Blocked",
  failed: "Failed"
};

const statusSeverities: Record<ReadinessCheck["status"], ReadinessSeverity> = {
  ready: "healthy",
  degraded: "warning",
  blocked: "danger",
  failed: "danger"
};

export function summarizeReadiness(
  readiness: ReadinessResponse
): ReadinessSummary {
  const blockedChecks = readiness.checks.filter(
    (check) => check.status === "blocked" || check.status === "failed"
  ).length;
  const degradedChecks = readiness.checks.filter(
    (check) => check.status === "degraded"
  ).length;
  const readyChecks = readiness.checks.filter(
    (check) => check.status === "ready"
  ).length;

  return {
    statusLabel: readiness.ok ? "Ready" : blockedChecks > 0 ? "Blocked" : "Degraded",
    severity: readiness.ok ? "healthy" : blockedChecks > 0 ? "danger" : "warning",
    deploymentLabel:
      readiness.deploymentMode === "production" ? "Production" : "Development",
    protectedByTokenLabel: readiness.protectedByToken
      ? "Token protected"
      : "No API token",
    activeJobsLabel:
      readiness.activeJobs === 1
        ? "1 active job"
        : `${readiness.activeJobs} active jobs`,
    blockedChecks,
    degradedChecks,
    readyChecks,
    totalChecks: readiness.checks.length
  };
}

export function buildReadinessCheckDisplay(
  checks: ReadinessCheck[]
): ReadinessCheckDisplay[] {
  return checks.map((check) => ({
    id: check.id,
    label: check.label,
    statusLabel: statusLabels[check.status],
    severity: statusSeverities[check.status],
    detail: buildCheckDetail(check)
  }));
}

function buildCheckDetail(check: ReadinessCheck): string {
  if (check.missing?.length) {
    return `Missing ${check.missing.join(", ")}.`;
  }

  if (check.id === "agents") {
    return buildAgentCheckDetail(check);
  }

  if (check.message) {
    return check.message;
  }

  return check.ok ? "No operator action needed." : "Operator action required.";
}

function buildAgentCheckDetail(check: ReadinessCheck): string {
  const healthyAgents = getNumber(check, "healthyAgents");
  const totalAgents = getNumber(check, "totalAgents");
  const degradedAgents = getDegradedAgents(check);

  if (healthyAgents !== undefined && totalAgents !== undefined) {
    const degradedLabel = degradedAgents
      .map((agent) => `${agent.id}: ${stripTrailingPeriod(agent.message)}`)
      .join("; ");
    const base = `${healthyAgents} of ${totalAgents} agents healthy`;

    return degradedLabel ? `${base}; ${degradedLabel}.` : `${base}.`;
  }

  return check.message ?? "Agent health requires attention.";
}

function getNumber(check: ReadinessCheck, key: string): number | undefined {
  const value = check[key];
  return typeof value === "number" ? value : undefined;
}

function getDegradedAgents(
  check: ReadinessCheck
): Array<{ id: string; message: string }> {
  const value = check.degradedAgents;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((agent) => {
    if (!isRecord(agent)) {
      return [];
    }

    const id = agent.id;
    const message = agent.message;

    if (typeof id !== "string" || typeof message !== "string") {
      return [];
    }

    return [{ id, message }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.$/, "");
}
