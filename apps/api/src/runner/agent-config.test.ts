import { describe, expect, it } from "vitest";
import {
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
});
