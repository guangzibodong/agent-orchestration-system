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

    expect(requests).toEqual(["/audit-events?limit=8", "/jobs?limit=8"]);
    expect(snapshot.auditEvents[0]?.type).toBe("workflow.enqueued");
    expect(snapshot.jobs[0]?.status).toBe("queued");
  });

  it("scopes audit and job history to a selected repository", async () => {
    const requests: string[] = [];
    await loadOperationsSnapshot(
      async (path) => {
        requests.push(path);
        return [];
      },
      { repositoryId: "repo 1" }
    );

    expect(requests).toEqual([
      "/audit-events?limit=8&repositoryId=repo+1",
      "/jobs?limit=8&repositoryId=repo+1"
    ]);
  });
});
