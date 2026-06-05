import { describe, expect, it } from "vitest";
import { PrismaJobStore } from "./prisma-job-store.js";
import type { WorkflowJob } from "./workflow-job-queue.js";

type JobRow = {
  id: string;
  workflowRunId: string;
  status: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

function createJobClient() {
  const rows: JobRow[] = [];

  return {
    rows,
    workflowJob: {
      async findMany() {
        return [...rows].sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
      },
      async upsert(args: {
        where: { id: string };
        create: JobRow;
        update: Omit<JobRow, "id">;
      }) {
        const existing = rows.find((row) => row.id === args.where.id);

        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }

        rows.push(args.create);
        return args.create;
      }
    }
  };
}

describe("PrismaJobStore", () => {
  it("saves jobs using workflowRunId and reconstructs WorkflowJob records", async () => {
    const client = createJobClient();
    const store = new PrismaJobStore(client);
    const job: WorkflowJob = {
      id: "job-1",
      workflowId: "workflow-1",
      status: "running",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      startedAt: "2026-06-05T00:00:30.000Z"
    };
    const completed: WorkflowJob = {
      ...job,
      status: "completed",
      updatedAt: "2026-06-05T00:02:00.000Z",
      finishedAt: "2026-06-05T00:02:00.000Z"
    };

    await store.save(job);
    await store.save(completed);

    expect(client.rows).toEqual([
      expect.objectContaining({
        id: "job-1",
        workflowRunId: "workflow-1",
        status: "completed",
        startedAt: new Date("2026-06-05T00:00:30.000Z"),
        finishedAt: new Date("2026-06-05T00:02:00.000Z")
      })
    ]);
    await expect(store.list()).resolves.toEqual([completed]);
  });
});
