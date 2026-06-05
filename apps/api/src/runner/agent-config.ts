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
  status: "healthy" | "missing_command";
  message: string;
  command?: string;
  checkedAt: string;
};

export type CommandAvailabilityCheck = (command: string) => Promise<boolean> | boolean;

const configuredAgents = [
  {
    id: "codex",
    label: "Codex CLI",
    envKey: "MAWO_CODEX_COMMAND_TEMPLATE"
  },
  {
    id: "claude",
    label: "Claude Code CLI",
    envKey: "MAWO_CLAUDE_COMMAND_TEMPLATE"
  },
  {
    id: "cursor",
    label: "Cursor CLI",
    envKey: "MAWO_CURSOR_COMMAND_TEMPLATE"
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
      commandTemplate
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
  commandExists: CommandAvailabilityCheck = defaultCommandExists
): Promise<AgentHealth[]> {
  const checkedAt = new Date().toISOString();
  const checks: AgentHealth[] = [];

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
    const healthy = command ? await commandExists(command) : false;

    checks.push({
      id: config.id,
      label: config.label,
      configured: true,
      healthy,
      status: healthy ? "healthy" : "missing_command",
      message: healthy
        ? `${config.label} command is available.`
        : `${config.label} command was not found on PATH.`,
      command,
      checkedAt
    });
  }

  return checks;
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
