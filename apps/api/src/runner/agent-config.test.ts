import { describe, expect, it } from "vitest";
import {
  createAgentHealthChecks,
  createAgentSummaries,
  createConfiguredAgentConfigs
} from "./agent-config.js";

describe("agent config", () => {
  it("keeps the demo fake agent and registers configured CLI agents", () => {
    const configs = createConfiguredAgentConfigs({
      MAWO_CODEX_COMMAND_TEMPLATE: "codex run --prompt-file {promptFile}",
      MAWO_CLAUDE_COMMAND_TEMPLATE: "claude -p @${promptFile}"
    });

    expect(configs.map((config) => config.id)).toEqual([
      "fake-agent",
      "codex",
      "claude"
    ]);
    expect(configs.find((config) => config.id === "codex")).toMatchObject({
      label: "Codex CLI",
      commandTemplate: "codex run --prompt-file {promptFile}"
    });
  });

  it("returns public summaries without command templates", () => {
    const summaries = createAgentSummaries(
      createConfiguredAgentConfigs({
        MAWO_CURSOR_COMMAND_TEMPLATE: "cursor-agent {promptFile}"
      })
    );

    expect(summaries).toEqual([
      { id: "fake-agent", label: "Fake CLI Agent" },
      { id: "cursor", label: "Cursor CLI" }
    ]);
  });

  it("reports fake agents as healthy without shell checks", async () => {
    const health = await createAgentHealthChecks(createConfiguredAgentConfigs({}));

    expect(health).toEqual([
      expect.objectContaining({
        id: "fake-agent",
        label: "Fake CLI Agent",
        configured: true,
        healthy: true,
        status: "healthy",
        message: "Built-in demo agent is available."
      })
    ]);
  });

  it("checks configured CLI command availability without exposing templates", async () => {
    const health = await createAgentHealthChecks(
      createConfiguredAgentConfigs({
        MAWO_CODEX_COMMAND_TEMPLATE: "missing-codex-binary run --prompt-file {promptFile}"
      }),
      async (command) => command === "missing-codex-binary" ? false : true
    );

    expect(health).toEqual([
      expect.objectContaining({
        id: "fake-agent",
        healthy: true
      }),
      expect.objectContaining({
        id: "codex",
        label: "Codex CLI",
        configured: true,
        healthy: false,
        status: "missing_command",
        command: "missing-codex-binary"
      })
    ]);
    expect(JSON.stringify(health)).not.toContain("{promptFile}");
  });
});
