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
      MAWO_CODEX_AUTH_PROBE_COMMAND: "codex auth status",
      MAWO_CLAUDE_COMMAND_TEMPLATE: "claude -p @${promptFile}"
    });

    expect(configs.map((config) => config.id)).toEqual([
      "fake-agent",
      "codex",
      "claude"
    ]);
    expect(configs.find((config) => config.id === "codex")).toMatchObject({
      label: "Codex CLI",
      commandTemplate: "codex run --prompt-file {promptFile}",
      authProbeCommand: "codex auth status"
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

  it("can include unconfigured CLI agents as preflight failures", async () => {
    const health = await createAgentHealthChecks(
      createConfiguredAgentConfigs({}),
      async () => true,
      async () => true,
      { includeUnconfigured: true }
    );

    expect(health).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex",
          label: "Codex CLI",
          configured: false,
          healthy: false,
          status: "missing_command",
          message:
            "Codex CLI command is not configured. Set MAWO_CODEX_COMMAND_TEMPLATE before enqueue."
        })
      ])
    );
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

  it("marks configured CLI agents unhealthy when their auth probe fails", async () => {
    const health = await createAgentHealthChecks(
      createConfiguredAgentConfigs({
        MAWO_CODEX_COMMAND_TEMPLATE: "codex run --prompt-file {promptFile}",
        MAWO_CODEX_AUTH_PROBE_COMMAND: "codex auth status"
      }),
      async () => true,
      async (command) => command === "codex auth status" ? false : true
    );

    expect(health).toEqual([
      expect.objectContaining({
        id: "fake-agent",
        healthy: true
      }),
      expect.objectContaining({
        id: "codex",
        healthy: false,
        status: "auth_failed",
        command: "codex",
        authProbeConfigured: true
      })
    ]);
    expect(JSON.stringify(health)).not.toContain("{promptFile}");
  });
});
