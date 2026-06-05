import { describe, expect, it } from "vitest";
import { PrismaJobStore } from "./prisma-job-store.js";
import type { WorkflowJob } from "./workflow-job-queue.js";

type JobRow = {
  id: string;
  workflowRunId: string;
  status: string;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  lockedBy: string | null;
  lockedAt: Date | string | null;
  leaseExpiresAt: Date | string | null;
  attempts: number;
};

function createJobClient() {
  const rows: JobRow[] = [];

  return {
    rows,
    workflowJob: {
      async findMany() {
        return [...rows].sort(
          (left, right) => toTime(left.updatedAt) - toTime(right.updatedAt)
        );
      },
      async findFirst(args: {
        where: { status: string };
        orderBy: { createdAt: "asc" };
      }) {
        return (
          [...rows]
            .filter((row) => row.status === args.where.status)
            .sort(
              (left, right) =>
                toTime(left.createdAt) - toTime(right.createdAt)
            )[0] ?? null
        );
      },
      async findUnique(args: { where: { id: string } }) {
        return rows.find((row) => row.id === args.where.id) ?? null;
      },
      async updateMany(args: {
        where: { id: string; status: string; lockedBy?: string };
        data: Partial<Omit<JobRow, "attempts">> & {
          attempts?: { increment: number };
        };
      }) {
        const row = rows.find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.status === args.where.status &&
            (!args.where.lockedBy || candidate.lockedBy === args.where.lockedBy)
        );

        if (!row) {
          return { count: 0 };
        }

        const attempts = args.data.attempts;
        Object.assign(row, {
          ...args.data,
          attempts:
            attempts && typeof attempts === "object"
              ? row.attempts + attempts.increment
              : args.data.attempts ?? row.attempts
        });

        return { count: 1 };
      },
      async upsert(args: {
        where: { id: string };
        create: JobRow;
        update: Omit<JobRow, "id" | "attempts">;
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

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
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
        finishedAt: new Date("2026-06-05T00:02:00.000Z"),
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        attempts: 0
      })
    ]);
    await expect(store.list()).resolves.toEqual([completed]);
  });

  it("claims the oldest queued job for one worker lease", async () => {
    const client = createJobClient();
    client.rows.push(
      {
        id: "job-newer",
        workflowRunId: "workflow-newer",
        status: "queued",
        error: null,
        createdAt: new Date("2026-06-05T00:02:00.000Z"),
        updatedAt: new Date("2026-06-05T00:02:00.000Z"),
        startedAt: null,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        attempts: 0
      },
      {
        id: "job-older",
        workflowRunId: "workflow-older",
        status: "queued",
        error: null,
        createdAt: new Date("2026-06-05T00:01:00.000Z"),
        updatedAt: new Date("2026-06-05T00:01:00.000Z"),
        startedAt: null,
        finishedAt: null,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        attempts: 0
      }
    );
    const store = new PrismaJobStore(client);
    const claimNextQueuedJob = (
      store as unknown as {
        claimNextQueuedJob?: (input: {
          workerId: string;
          now: Date;
          leaseExpiresAt: Date;
        }) => Promise<WorkflowJob | undefined>;
      }
    ).claimNextQueuedJob;

    expect(claimNextQueuedJob).toEqual(expect.any(Function));

    const claimed = await claimNextQueuedJob?.call(store, {
      workerId: "worker-a",
      now: new Date("2026-06-05T00:03:00.000Z"),
      leaseExpiresAt: new Date("2026-06-05T00:08:00.000Z")
    });

    expect(claimed).toMatchObject({
      id: "job-older",
      workflowId: "workflow-older",
      status: "running",
      startedAt: "2026-06-05T00:03:00.000Z"
    });
    expect(client.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job-older",
          status: "running",
          lockedBy: "worker-a",
          lockedAt: new Date("2026-06-05T00:03:00.000Z"),
          leaseExpiresAt: new Date("2026-06-05T00:08:00.000Z"),
          attempts: 1
        }),
        expect.objectContaining({
          id: "job-newer",
          status: "queued",
          lockedBy: null
        })
      ])
    );
  });

  it("renews a running job lease only for the owning worker", async () => {
    const client = createJobClient();
    client.rows.push({
      id: "job-claimed",
      workflowRunId: "workflow-claimed",
      status: "running",
      error: null,
      createdAt: new Date("2026-06-05T00:01:00.000Z"),
      updatedAt: new Date("2026-06-05T00:03:00.000Z"),
      startedAt: new Date("2026-06-05T00:03:00.000Z"),
      finishedAt: null,
      lockedBy: "worker-a",
      lockedAt: new Date("2026-06-05T00:03:00.000Z"),
      leaseExpiresAt: new Date("2026-06-05T00:08:00.000Z"),
      attempts: 1
    });
    const store = new PrismaJobStore(client);
    const renewJobLease = (
      store as unknown as {
        renewJobLease?: (input: {
          jobId: string;
          workerId: string;
          now: Date;
          leaseExpiresAt: Date;
        }) => Promise<boolean>;
      }
    ).renewJobLease;

    expect(renewJobLease).toEqual(expect.any(Function));

    await expect(
      renewJobLease?.call(store, {
        jobId: "job-claimed",
        workerId: "worker-b",
        now: new Date("2026-06-05T00:04:00.000Z"),
        leaseExpiresAt: new Date("2026-06-05T00:09:00.000Z")
      })
    ).resolves.toBe(false);
    await expect(
      renewJobLease?.call(store, {
        jobId: "job-claimed",
        workerId: "worker-a",
        now: new Date("2026-06-05T00:04:00.000Z"),
        leaseExpiresAt: new Date("2026-06-05T00:09:00.000Z")
      })
    ).resolves.toBe(true);

    expect(client.rows[0]).toMatchObject({
      id: "job-claimed",
      lockedBy: "worker-a",
      lockedAt: new Date("2026-06-05T00:04:00.000Z"),
      leaseExpiresAt: new Date("2026-06-05T00:09:00.000Z"),
      attempts: 1
    });
  });
});
