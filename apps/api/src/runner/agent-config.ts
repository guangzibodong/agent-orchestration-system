import { createFakeAgentConfig } from "./demo-repository.js";
import type { CliAgentConfig } from "./cli-agent-adapter.js";
import { spawnSync } from "node:child_process";

type AgentEnv = Record<string, string | undefined>;

export type AgentSummary = {
  id: string;
  label: string;
};

export type AgentHealth = AgentSummary & {
  configured: boolean;
  healthy: boolean;
  status: "healthy" | "missing_command" | "auth_unchecked" | "auth_failed";
  message: string;
  command?: string;
  authProbeConfigured?: boolean;
  checkedAt: string;
};

export type CommandAvailabilityCheck = (command: string) => Promise<boolean> | boolean;
export type AuthProbeCheck = (command: string) => Promise<boolean> | boolean;
export type AgentHealthCheckOptions = {
  includeUnconfigured?: boolean;
};

const configuredAgents = [
  {
    id: "codex",
    label: "Codex CLI",
    envKey: "MAWO_CODEX_COMMAND_TEMPLATE",
    authProbeEnvKey: "MAWO_CODEX_AUTH_PROBE_COMMAND"
  },
  {
    id: "claude",
    label: "Claude Code CLI",
    envKey: "MAWO_CLAUDE_COMMAND_TEMPLATE",
    authProbeEnvKey: "MAWO_CLAUDE_AUTH_PROBE_COMMAND"
  },
  {
    id: "cursor",
    label: "Cursor CLI",
    envKey: "MAWO_CURSOR_COMMAND_TEMPLATE",
    authProbeEnvKey: "MAWO_CURSOR_AUTH_PROBE_COMMAND"
  }
] as const;

export function createConfiguredAgentConfigs(
  env: AgentEnv = process.env
): CliAgentConfig[] {
  const configs: CliAgentConfig[] = [createFakeAgentConfig()];

  for (const agent of configuredAgents) {
    const commandTemplate = env[agent.envKey]?.trim();

    if (!commandTemplate) {
      continue;
    }

    configs.push({
      id: agent.id,
      label: agent.label,
      commandTemplate,
      authProbeCommand: env[agent.authProbeEnvKey]?.trim() || undefined
    });
  }

  return configs;
}

export function createAgentSummaries(
  configs: CliAgentConfig[]
): AgentSummary[] {
  return configs.map((config) => ({
    id: config.id,
    label: config.label
  }));
}

export async function createAgentHealthChecks(
  configs: CliAgentConfig[],
  commandExists: CommandAvailabilityCheck = defaultCommandExists,
  authProbePasses: AuthProbeCheck = defaultAuthProbePasses,
  options: AgentHealthCheckOptions = {}
): Promise<AgentHealth[]> {
  const checkedAt = new Date().toISOString();
  const checks: AgentHealth[] = [];
  const configuredIds = new Set(configs.map((config) => config.id));

  for (const config of configs) {
    if (config.id === "fake-agent") {
      checks.push({
        id: config.id,
        label: config.label,
        configured: true,
        healthy: true,
        status: "healthy",
        message: "Built-in demo agent is available.",
        checkedAt
      });
      continue;
    }

    const command = extractCommandToken(config.commandTemplate);
    const commandHealthy = command ? await commandExists(command) : false;
    const authProbeConfigured = Boolean(config.authProbeCommand);
    const authProbeHealthy =
      commandHealthy && config.authProbeCommand
        ? await authProbePasses(config.authProbeCommand)
        : undefined;
    const healthy = commandHealthy && authProbeHealthy !== false;
    const status = !commandHealthy
      ? "missing_command"
      : authProbeHealthy === false
        ? "auth_failed"
        : authProbeConfigured
          ? "healthy"
          : "auth_unchecked";

    checks.push({
      id: config.id,
      label: config.label,
      configured: true,
      healthy,
      status,
      message: createHealthMessage(config.label, status),
      command,
      authProbeConfigured,
      checkedAt
    });
  }

  if (options.includeUnconfigured) {
    for (const agent of configuredAgents) {
      if (configuredIds.has(agent.id)) {
        continue;
      }

      checks.push({
        id: agent.id,
        label: agent.label,
        configured: false,
        healthy: false,
        status: "missing_command",
        message: `${agent.label} command is not configured. Set ${agent.envKey} before enqueue.`,
        checkedAt
      });
    }
  }

  return checks;
}

function createHealthMessage(
  label: string,
  status: AgentHealth["status"]
): string {
  if (status === "healthy") {
    return `${label} command and auth probe are available.`;
  }

  if (status === "auth_failed") {
    return `${label} auth probe failed.`;
  }

  if (status === "auth_unchecked") {
    return `${label} command is available; auth probe is not configured.`;
  }

  return `${label} command was not found on PATH.`;
}

function extractCommandToken(commandTemplate: string): string | undefined {
  const trimmed = commandTemplate.trim();

  if (!trimmed) {
    return undefined;
  }

  const quote = trimmed[0];
  if (quote === "\"" || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end > 1 ? trimmed.slice(1, end) : trimmed.slice(1);
  }

  return trimmed.split(/\s+/)[0];
}

function defaultCommandExists(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, {
    shell: process.platform !== "win32",
    windowsHide: true,
    stdio: "ignore"
  });

  return result.status === 0;
}

function defaultAuthProbePasses(command: string): boolean {
  const result = spawnSync(command, {
    shell: true,
    windowsHide: true,
    stdio: "ignore"
  });

  return result.status === 0;
}
