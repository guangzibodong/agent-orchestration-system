import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAuditStore } from "./file-audit-store.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("FileAuditStore", () => {
  it("filters events by type actor job and repository metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "mawo-audit-store-test-"));
    tempRoots.push(root);
    const store = new FileAuditStore({
      stateFile: join(root, "state", "audit-events.json")
    });

    const repositoryEvent = store.append({
      type: "repository.updated",
      actor: "operator",
      metadata: {
        repositoryId: "repo-1",
        repositoryName: "Core repo"
      }
    });
    store.append({
      type: "repository.deleted",
      actor: "operator",
      metadata: {
        repositoryId: "repo-2",
        repositoryName: "Old repo"
      }
    });
    const jobEvent = store.append({
      type: "job.canceled",
      actor: "operator",
      workflowId: "workflow-1",
      jobId: "job-1",
      metadata: {
        status: "canceled"
      }
    });

    expect(
      store.list({
        type: "repository.updated",
        actor: "operator",
        repositoryId: "repo-1"
      })
    ).toEqual([repositoryEvent]);
    expect(
      store.list({
        jobId: "job-1",
        actor: "operator"
      })
    ).toEqual([jobEvent]);
  });
});
