import { describe, expect, it } from "vitest";
import type { ReadinessResponse } from "@mawo/shared";
import {
  buildReadinessCheckDisplay,
  summarizeReadiness
} from "./readiness-display";

const readiness: ReadinessResponse = {
  ok: false,
  service: "mawo-api",
  checkedAt: "2026-06-05T19:54:24.148Z",
  deploymentMode: "production",
  protectedByToken: true,
  root: "C:/mawo",
  activeJobs: 2,
  checks: [
    {
      id: "state_store",
      label: "State store",
      ok: true,
      status: "ready"
    },
    {
      id: "agents",
      label: "Agent health",
      ok: false,
      status: "degraded",
      healthyAgents: 1,
      totalAgents: 2,
      degradedAgents: [
        {
          id: "codex",
          status: "auth_failed",
          message: "Codex auth probe failed."
        }
      ]
    },
    {
      id: "production_config",
      label: "Production security config",
      ok: false,
      status: "blocked",
      missing: ["MAWO_ALLOWED_REPOSITORY_ROOTS"],
      deploymentMode: "production",
      protectedByToken: true,
      allowedRepositoryRootsConfigured: false
    }
  ]
};

describe("readiness display", () => {
  it("summarizes production blockers and active queue pressure", () => {
    expect(summarizeReadiness(readiness)).toEqual({
      statusLabel: "Blocked",
      severity: "danger",
      deploymentLabel: "Production",
      protectedByTokenLabel: "Token protected",
      activeJobsLabel: "2 active jobs",
      blockedChecks: 1,
      degradedChecks: 1,
      readyChecks: 1,
      totalChecks: 3
    });
  });

  it("maps readiness checks to operator-facing labels", () => {
    expect(buildReadinessCheckDisplay(readiness.checks)).toEqual([
      {
        id: "state_store",
        label: "State store",
        statusLabel: "Ready",
        severity: "healthy",
        detail: "No operator action needed."
      },
      {
        id: "agents",
        label: "Agent health",
        statusLabel: "Degraded",
        severity: "warning",
        detail: "1 of 2 agents healthy; codex: Codex auth probe failed."
      },
      {
        id: "production_config",
        label: "Production security config",
        statusLabel: "Blocked",
        severity: "danger",
        detail: "Missing MAWO_ALLOWED_REPOSITORY_ROOTS."
      }
    ]);
  });
});
