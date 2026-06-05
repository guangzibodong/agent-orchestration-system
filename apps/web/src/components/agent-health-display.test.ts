import { describe, expect, it } from "vitest";
import type { AgentHealth } from "@mawo/shared";
import {
  buildAgentHealthDisplay,
  summarizeAgentHealth
} from "./agent-health-display";

const checkedAt = "2026-06-05T09:58:10.026Z";

describe("agent health display", () => {
  it("maps runtime health states to operator-facing labels", () => {
    const health: AgentHealth[] = [
      {
        id: "codex",
        label: "Codex CLI",
        configured: true,
        healthy: true,
        status: "healthy",
        message: "Codex CLI command and auth probe are available.",
        command: "codex",
        authProbeConfigured: true,
        checkedAt
      },
      {
        id: "claude",
        label: "Claude Code CLI",
        configured: true,
        healthy: false,
        status: "auth_failed",
        message: "Claude Code CLI auth probe failed.",
        command: "claude",
        authProbeConfigured: true,
        checkedAt
      },
      {
        id: "cursor",
        label: "Cursor CLI",
        configured: true,
        healthy: true,
        status: "auth_unchecked",
        message: "Cursor CLI command is available; auth probe is not configured.",
        command: "cursor",
        authProbeConfigured: false,
        checkedAt
      }
    ];

    expect(buildAgentHealthDisplay(health)).toEqual([
      {
        id: "codex",
        label: "Codex CLI",
        statusLabel: "Healthy",
        severity: "healthy",
        message: "Codex CLI command and auth probe are available.",
        command: "codex",
        checkedAt
      },
      {
        id: "claude",
        label: "Claude Code CLI",
        statusLabel: "Auth Failed",
        severity: "danger",
        message: "Claude Code CLI auth probe failed.",
        command: "claude",
        checkedAt
      },
      {
        id: "cursor",
        label: "Cursor CLI",
        statusLabel: "Auth Unchecked",
        severity: "warning",
        message: "Cursor CLI command is available; auth probe is not configured.",
        command: "cursor",
        checkedAt
      }
    ]);
  });

  it("summarizes agents that need operator attention", () => {
    expect(
      summarizeAgentHealth([
        {
          id: "fake-agent",
          label: "Built-in Demo Agent",
          configured: true,
          healthy: true,
          status: "healthy",
          message: "Built-in demo agent is available.",
          checkedAt
        },
        {
          id: "codex",
          label: "Codex CLI",
          configured: true,
          healthy: false,
          status: "missing_command",
          message: "Codex CLI command was not found on PATH.",
          command: "codex",
          authProbeConfigured: false,
          checkedAt
        }
      ])
    ).toEqual({
      total: 2,
      healthy: 1,
      needsAttention: 1
    });
  });
});
