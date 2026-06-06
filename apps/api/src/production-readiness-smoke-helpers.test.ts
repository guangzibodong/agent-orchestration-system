import { describe, expect, it } from "vitest";
import { assertProductionReadinessSmokeReady } from "./production-readiness-smoke-helpers.js";

describe("production readiness smoke helpers", () => {
  it("requires a protected production readiness response with file-backed runtime checks ready", () => {
    const checks = [
      {
        id: "state_store",
        ok: true,
        status: "ready",
        path: "C:/tmp/mawo/.mawo/state",
      },
      {
        id: "artifact_store",
        ok: true,
        status: "ready",
        path: "C:/tmp/mawo/.mawo/artifacts",
      },
      {
        id: "git_cli",
        ok: true,
        status: "ready",
      },
      {
        id: "agents",
        ok: true,
        status: "ready",
        healthyAgents: 1,
        totalAgents: 1,
      },
      {
        id: "production_config",
        ok: true,
        status: "ready",
        deploymentMode: "production",
        protectedByToken: true,
        allowedRepositoryRootsConfigured: true,
        missing: [],
      },
      {
        id: "runtime_backend",
        ok: true,
        status: "ready",
        requestedStateBackend: "file",
        activeStateBackend: "file",
        requestedQueueBackend: "in_process",
        activeQueueBackend: "in_process",
      },
      {
        id: "workers",
        ok: true,
        status: "ready",
        required: false,
        healthyWorkers: 0,
      },
      {
        id: "deployment_topology",
        ok: true,
        status: "ready",
        deploymentMode: "production",
        apiReplicaCount: 1,
        stateBackend: "file",
        queueBackend: "in_process",
      },
    ];

    expect(() =>
      assertProductionReadinessSmokeReady({
        ok: true,
        service: "mawo-api",
        checkedAt: "2026-06-06T17:42:36.310Z",
        deploymentMode: "production",
        protectedByToken: true,
        activeJobs: 0,
        checks,
      }),
    ).not.toThrow();
  });

  it("rejects degraded, unprotected, or template-leaking readiness responses", () => {
    expect(() =>
      assertProductionReadinessSmokeReady({
        ok: true,
        service: "mawo-api",
        deploymentMode: "development",
        protectedByToken: false,
        activeJobs: 0,
        checks: [],
      }),
    ).toThrow("deploymentMode=production");

    expect(() =>
      assertProductionReadinessSmokeReady({
        ok: true,
        service: "mawo-api",
        deploymentMode: "production",
        protectedByToken: true,
        activeJobs: 0,
        checks: [
          {
            id: "agents",
            ok: true,
            status: "ready",
            degradedAgents: [{ command: "{promptFile}" }],
          },
        ],
      }),
    ).toThrow("leaked a command template");
  });
});
