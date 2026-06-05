import { randomUUID } from "node:crypto";
import type { LocalRunner } from "./local-runner.js";

export type WorkflowJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type WorkflowJob = {
  id: string;
  workflowId: string;
  status: WorkflowJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type WorkflowJobQueueOptions = {
  runner: LocalRunner;
};

export class WorkflowAlreadyRunningError extends Error {
  readonly job: WorkflowJob;

  constructor(workflowId: string, job: WorkflowJob) {
    super(`Workflow ${workflowId} already has an active job ${job.id}`);
    this.name = "WorkflowAlreadyRunningError";
    this.job = job;
  }
}

export class WorkflowJobQueue {
  private readonly runner: LocalRunner;
  private readonly jobs = new Map<string, WorkflowJob>();
  private readonly waiters = new Map<string, Array<(job: WorkflowJob) => void>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(options: WorkflowJobQueueOptions) {
    this.runner = options.runner;
  }

  enqueue(workflowId: string): WorkflowJob {
    const activeJob = this.getActiveJobForWorkflow(workflowId);

    if (activeJob) {
      throw new WorkflowAlreadyRunningError(workflowId, activeJob);
    }

    const now = new Date().toISOString();
    const job: WorkflowJob = {
      id: randomUUID(),
      workflowId,
      status: "queued",
      createdAt: now,
      updatedAt: now
    };

    this.jobs.set(job.id, job);
    setTimeout(() => {
      void this.process(job.id);
    }, 0);

    return job;
  }

  listJobs(): WorkflowJob[] {
    return [...this.jobs.values()];
  }

  getJob(id: string): WorkflowJob | undefined {
    return this.jobs.get(id);
  }

  getActiveJobForWorkflow(workflowId: string): WorkflowJob | undefined {
    return [...this.jobs.values()].find(
      (job) =>
        job.workflowId === workflowId &&
        (job.status === "queued" ||
          job.status === "running" ||
          this.controllers.has(job.id))
    );
  }

  cancelJob(id: string): WorkflowJob | undefined {
    const job = this.jobs.get(id);

    if (!job) {
      return undefined;
    }

    if (this.isTerminal(job)) {
      return job;
    }

    this.controllers.get(id)?.abort();
    this.update(job, {
      status: "canceled",
      finishedAt: new Date().toISOString()
    });

    return job;
  }

  async waitForJob(id: string, timeoutMs: number): Promise<WorkflowJob> {
    const current = this.getJob(id);

    if (!current) {
      throw new Error(`Job not found: ${id}`);
    }

    if (this.isTerminal(current)) {
      return current;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for job: ${id}`));
      }, timeoutMs);

      const waiters = this.waiters.get(id) ?? [];
      waiters.push((job) => {
        if (this.isTerminal(job)) {
          clearTimeout(timeout);
          resolve(job);
        }
      });
      this.waiters.set(id, waiters);
    });
  }

  private async process(id: string): Promise<void> {
    const job = this.jobs.get(id);

    if (!job || job.status !== "queued") {
      return;
    }

    this.update(job, {
      status: "running",
      startedAt: new Date().toISOString()
    });
    const controller = new AbortController();
    this.controllers.set(id, controller);

    try {
      await this.runner.runWorkflow(job.workflowId, {
        signal: controller.signal
      });
      if (this.jobs.get(id)?.status === "canceled") {
        this.controllers.delete(id);
        return;
      }
      this.update(job, {
        status: "completed",
        finishedAt: new Date().toISOString()
      });
    } catch (error) {
      if (this.jobs.get(id)?.status === "canceled") {
        this.controllers.delete(id);
        return;
      }
      this.update(job, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.controllers.delete(id);
    }
  }

  private update(job: WorkflowJob, patch: Partial<WorkflowJob>): void {
    Object.assign(job, patch, {
      updatedAt: new Date().toISOString()
    });
    this.jobs.set(job.id, job);

    for (const waiter of this.waiters.get(job.id) ?? []) {
      waiter(job);
    }
  }

  private isTerminal(job: WorkflowJob): boolean {
    return ["completed", "failed", "canceled"].includes(job.status);
  }
}
