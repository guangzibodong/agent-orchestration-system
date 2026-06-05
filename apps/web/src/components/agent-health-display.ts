import type { AgentHealth } from "@mawo/shared";

export type AgentHealthSeverity = "healthy" | "warning" | "danger";

export type AgentHealthDisplay = {
  id: string;
  label: string;
  statusLabel: string;
  severity: AgentHealthSeverity;
  message: string;
  command?: string;
  checkedAt: string;
};

const statusLabels: Record<AgentHealth["status"], string> = {
  healthy: "Healthy",
  missing_command: "Command Missing",
  auth_unchecked: "Auth Unchecked",
  auth_failed: "Auth Failed"
};

const statusSeverities: Record<AgentHealth["status"], AgentHealthSeverity> = {
  healthy: "healthy",
  missing_command: "danger",
  auth_unchecked: "warning",
  auth_failed: "danger"
};

export function buildAgentHealthDisplay(
  health: AgentHealth[]
): AgentHealthDisplay[] {
  return health.map((agent) => ({
    id: agent.id,
    label: agent.label,
    statusLabel: statusLabels[agent.status],
    severity: statusSeverities[agent.status],
    message: agent.message,
    command: agent.command,
    checkedAt: agent.checkedAt
  }));
}

export function summarizeAgentHealth(health: AgentHealth[]): {
  total: number;
  healthy: number;
  needsAttention: number;
} {
  const healthy = health.filter((agent) => agent.status === "healthy").length;

  return {
    total: health.length,
    healthy,
    needsAttention: health.length - healthy
  };
}
