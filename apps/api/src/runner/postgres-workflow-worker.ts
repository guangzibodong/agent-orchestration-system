import { randomUUID } from "node:crypto";
import type { LocalRunner, RunWorkflowOptions } from "./local-runner.js";
import type { WorkflowJob } from "./workflow-job-queue.js";
import type {
  ClaimNextQueuedJobInput,
  RenewJobLeaseInput
} from "./prisma-job-store.js";

export type PostgresWorkflowWorkerJobStore = {
  claimNextQueuedJob(
    input: ClaimNextQueuedJobInput
  ): Promise<WorkflowJob | undefined>;
  renewJobLease(input: RenewJobLeaseInput): Promise<boolean>;
  save(job: WorkflowJob): Promise<void>;
};

export type PostgresWorkflowWorkerRunner = Pick<
  LocalRunner,
  "flush" | "ready"
> & {
  runWorkflow(
    workflowId: string,
    options?: RunWorkflowOptions
  ): Promise<unknown>;
};

export type PostgresWorkflowWorkerOptions = {
  jobStore: PostgresWorkflowWorkerJobStore;
  runner: PostgresWorkflowWorkerRunner;
  workerId?: string;
  leaseMs?: number;
  renewIntervalMs?: number;
  now?: () => Date;
};

export type PostgresWorkflowWorkerRunOnceResult =
  | {
      status: "idle";
    }
  | {
      status: "completed" | "failed";
      job: WorkflowJob;
    };

export class PostgresWorkflowWorker {
  private readonly jobStore: PostgresWorkflowWorkerJobStore;
  private readonly runner: PostgresWorkflowWorkerRunner;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly renewIntervalMs: number;
  private readonly now: () => Date;

  constructor(options: PostgresWorkflowWorkerOptions) {
    this.jobStore = options.jobStore;
    this.runner = options.runner;
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.leaseMs = normalizePositiveInteger(options.leaseMs, 5 * 60 * 1000);
    this.renewIntervalMs = normalizePositiveInteger(
      options.renewIntervalMs,
      Math.max(1_000, Math.floor(this.leaseMs / 3))
    );
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<PostgresWorkflowWorkerRunOnceResult> {
    await this.runner.ready();
    const claimed = await this.jobStore.claimNextQueuedJob({
      workerId: this.workerId,
      now: this.now(),
      leaseExpiresAt: this.leaseExpiresAt()
    });

    if (!claimed) {
      return {
        status: "idle"
      };
    }

    const controller = new AbortController();
    const stopRenewal = this.startLeaseRenewal(claimed.id);

    try {
      await this.runner.runWorkflow(claimed.workflowId, {
        signal: controller.signal
      });
      await this.runner.flush();
      const completed = this.finishJob(claimed, {
        status: "completed"
      });
      await this.jobStore.save(completed);

      return {
        status: "completed",
        job: completed
      };
    } catch (error) {
      const failed = this.finishJob(claimed, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      await this.jobStore.save(failed);

      return {
        status: "failed",
        job: failed
      };
    } finally {
      stopRenewal();
    }
  }

  private startLeaseRenewal(jobId: string): () => void {
    const interval = setInterval(() => {
      void this.jobStore
        .renewJobLease({
          jobId,
          workerId: this.workerId,
          now: this.now(),
          leaseExpiresAt: this.leaseExpiresAt()
        })
        .catch(() => undefined);
    }, this.renewIntervalMs);

    return () => {
      clearInterval(interval);
    };
  }

  private finishJob(
    job: WorkflowJob,
    patch: {
      status: "completed" | "failed";
      error?: string;
    }
  ): WorkflowJob {
    const finishedAt = this.now().toISOString();

    return {
      ...job,
      status: patch.status,
      updatedAt: finishedAt,
      finishedAt,
      ...(patch.error ? { error: patch.error } : { error: undefined })
    };
  }

  private leaseExpiresAt(): Date {
    return new Date(this.now().getTime() + this.leaseMs);
  }
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value ?? fallback));
}
