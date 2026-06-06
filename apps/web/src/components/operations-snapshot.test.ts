import { describe, expect, it } from "vitest";
import { loadOperationsSnapshot } from "./operations-snapshot";

describe("operations snapshot", () => {
  it("loads bounded audit and job history for the console", async () => {
    const requests: string[] = [];
    const snapshot = await loadOperationsSnapshot(async (path) => {
      requests.push(path);

      if (path === "/audit-events?limit=8") {
        return [
          {
            id: "event-1",
            type: "workflow.enqueued",
            createdAt: "2026-06-05T11:03:11.135Z",
            actor: "operator",
            workflowId: "workflow-1"
          }
        ];
      }

      if (path === "/readiness") {
        return {
          ok: true,
          service: "mawo-api",
          checkedAt: "2026-06-05T19:54:24.148Z",
          deploymentMode: "development",
          protectedByToken: false,
          root: "C:/mawo",
          activeJobs: 0,
          checks: []
        };
      }

      if (path === "/workers/health") {
        return {
          ok: true,
          checkedAt: "2026-06-05T19:54:24.148Z",
          staleAfterMs: 60000,
          summary: {
            totalWorkers: 1,
            healthyWorkers: 1,
            staleWorkers: 0
          },
          workers: [
            {
              workerId: "worker-a",
              healthy: true,
              status: "idle",
              lastSeenAt: "2026-06-05T19:54:20.000Z",
              ageMs: 4148
            }
          ]
        };
      }

      return [
        {
          id: "job-1",
          workflowId: "workflow-1",
          status: "queued",
          createdAt: "2026-06-05T11:03:11.135Z",
          updatedAt: "2026-06-05T11:03:11.135Z"
        }
      ];
    });

    expect(requests).toEqual([
      "/audit-events?limit=8",
      "/jobs?limit=8",
      "/readiness",
      "/workers/health"
    ]);
    expect(snapshot.auditEvents[0]?.type).toBe("workflow.enqueued");
    expect(snapshot.jobs[0]?.status).toBe("queued");
    expect(snapshot.readiness.ok).toBe(true);
    expect(snapshot.workerHealth.summary.healthyWorkers).toBe(1);
  });

  it("scopes audit and job history to a selected repository", async () => {
    const requests: string[] = [];
    await loadOperationsSnapshot(
      async (path) => {
        requests.push(path);
        if (path === "/readiness") {
          return {
            ok: true,
            service: "mawo-api",
            checkedAt: "2026-06-05T19:54:24.148Z",
            deploymentMode: "development",
            protectedByToken: false,
            root: "C:/mawo",
            activeJobs: 0,
            checks: []
          };
        }

        if (path === "/workers/health") {
          return {
            ok: true,
            checkedAt: "2026-06-05T19:54:24.148Z",
            staleAfterMs: 60000,
            summary: {
              totalWorkers: 0,
              healthyWorkers: 0,
              staleWorkers: 0
            },
            workers: []
          };
        }

        return [];
      },
      { repositoryId: "repo 1" }
    );

    expect(requests).toEqual([
      "/audit-events?limit=8&repositoryId=repo+1",
      "/jobs?limit=8&repositoryId=repo+1",
      "/readiness",
      "/workers/health"
    ]);
  });
});
