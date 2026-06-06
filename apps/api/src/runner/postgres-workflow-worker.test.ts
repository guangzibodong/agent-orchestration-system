import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PostgresWorkflowWorker,
  type PostgresWorkflowWorkerJobStore,
  type PostgresWorkflowWorkerRunner
} from "./postgres-workflow-worker.js";
import type { WorkflowJob } from "./workflow-job-queue.js";

function createJob(overrides: Partial<WorkflowJob> = {}): WorkflowJob {
  return {
    id: "job-1",
    workflowId: "workflow-1",
    status: "running",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:01:00.000Z",
    startedAt: "2026-06-05T00:01:00.000Z",
    ...overrides
  };
}

function createHarness(job?: WorkflowJob) {
  const saved: WorkflowJob[] = [];
  const renewals: Array<{
    jobId: string;
    workerId: string;
    leaseExpiresAt: Date;
  }> = [];
  const store: PostgresWorkflowWorkerJobStore = {
    claimNextQueuedJob: vi.fn(async () => job),
    renewJobLease: vi.fn(async (input) => {
      renewals.push({
        jobId: input.jobId,
        workerId: input.workerId,
        leaseExpiresAt: input.leaseExpiresAt
      });
      return true;
    }),
    save: vi.fn(async (updated) => {
      saved.push(updated);
    })
  };
  const runner: PostgresWorkflowWorkerRunner = {
    ready: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    runWorkflow: vi.fn(async () => ({ id: job?.workflowId ?? "workflow-1" }))
  };

  return { renewals, runner, saved, store };
}

describe("PostgresWorkflowWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("claims one queued job, runs the workflow, and persists completion", async () => {
    const job = createJob();
    const { runner, saved, store } = createHarness(job);
    const worker = new PostgresWorkflowWorker({
      jobStore: store,
      runner,
      workerId: "worker-a",
      leaseMs: 300_000,
      now: () => new Date("2026-06-05T00:02:00.000Z")
    });

    const result = await worker.runOnce();

    expect(result).toMatchObject({
      status: "completed",
      job: expect.objectContaining({
        id: "job-1",
        status: "completed",
        finishedAt: "2026-06-05T00:02:00.000Z"
      })
    });
    expect(store.claimNextQueuedJob).toHaveBeenCalledWith({
      workerId: "worker-a",
      now: new Date("2026-06-05T00:02:00.000Z"),
      leaseExpiresAt: new Date("2026-06-05T00:07:00.000Z")
    });
    expect(runner.runWorkflow).toHaveBeenCalledWith("workflow-1", {
      signal: expect.any(AbortSignal)
    });
    expect(runner.flush).toHaveBeenCalled();
    expect(saved).toEqual([
      expect.objectContaining({
        id: "job-1",
        workflowId: "workflow-1",
        status: "completed",
        finishedAt: "2026-06-05T00:02:00.000Z"
      })
    ]);
  });

  it("returns idle when there is no queued job to claim", async () => {
    const { runner, saved, store } = createHarness();
    const worker = new PostgresWorkflowWorker({
      jobStore: store,
      runner,
      workerId: "worker-a"
    });

    await expect(worker.runOnce()).resolves.toEqual({
      status: "idle"
    });
    expect(runner.runWorkflow).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("marks the claimed job failed when workflow execution throws", async () => {
    const job = createJob();
    const { runner, saved, store } = createHarness(job);
    vi.mocked(runner.runWorkflow).mockRejectedValueOnce(
      new Error("workflow exploded")
    );
    const worker = new PostgresWorkflowWorker({
      jobStore: store,
      runner,
      workerId: "worker-a",
      now: () => new Date("2026-06-05T00:03:00.000Z")
    });

    const result = await worker.runOnce();

    expect(result).toMatchObject({
      status: "failed",
      job: expect.objectContaining({
        status: "failed",
        error: "workflow exploded"
      })
    });
    expect(saved).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "workflow exploded",
        finishedAt: "2026-06-05T00:03:00.000Z"
      })
    ]);
  });

  it("renews the job lease while the workflow is running", async () => {
    vi.useFakeTimers();
    const job = createJob();
    const { renewals, runner, store } = createHarness(job);
    let finishWorkflow: (() => void) | undefined;
    vi.mocked(runner.runWorkflow).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWorkflow = () => resolve({ id: job.workflowId });
        })
    );
    const worker = new PostgresWorkflowWorker({
      jobStore: store,
      runner,
      workerId: "worker-a",
      leaseMs: 10_000,
      renewIntervalMs: 1_000,
      now: () => new Date("2026-06-05T00:04:00.000Z")
    });

    const running = worker.runOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    finishWorkflow?.();
    await running;

    expect(renewals).toEqual([
      {
        jobId: "job-1",
        workerId: "worker-a",
        leaseExpiresAt: new Date("2026-06-05T00:04:10.000Z")
      }
    ]);
  });
});
