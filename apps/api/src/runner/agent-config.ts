import { createFakeAgentConfig } from "./demo-repository.js";
import type { CliAgentConfig } from "./cli-agent-adapter.js";

type AgentEnv = Record<string, string | undefined>;

export type AgentSummary = {
  id: string;
  label: string;
};

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
