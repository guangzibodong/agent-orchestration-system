import { randomUUID } from "node:crypto";
import type { LocalRunner } from "./local-runner.js";
import type { JobStore } from "./file-job-store.js";

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
  jobStore?: JobStore;
  maxConcurrentJobs?: number;
  onJobRecovered?: (event: {
    original: WorkflowJob;
    recovered: WorkflowJob;
  }) => void;
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
  private readonly jobStore?: JobStore;
  private readonly maxConcurrentJobs: number;
  private readonly jobs = new Map<string, WorkflowJob>();
  private readonly waiters = new Map<string, Array<(job: WorkflowJob) => void>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly readyPromise: Promise<void>;
  private pendingPersistence = Promise.resolve();
  private readyState = false;
  private readonly onJobRecovered?: WorkflowJobQueueOptions["onJobRecovered"];

  constructor(options: WorkflowJobQueueOptions) {
    this.runner = options.runner;
    this.jobStore = options.jobStore;
    this.onJobRecovered = options.onJobRecovered;
    this.maxConcurrentJobs = normalizeMaxConcurrentJobs(
      options.maxConcurrentJobs
    );
    this.readyPromise = this.restorePersistedJobs();
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  async flush(): Promise<void> {
    await this.ready();
    await this.pendingPersistence;
  }

  isReady(): boolean {
    return this.readyState;
  }

  private restorePersistedJobs(): Promise<void> {
    const restoredJobs = this.jobStore?.list() ?? [];

    if (isPromiseLike(restoredJobs) || !this.runner.isReady()) {
      return Promise.resolve(restoredJobs).then(async (jobs) => {
        await this.runner.ready();
        await this.loadJobs(jobs);
      });
    }

    const loaded = this.loadJobs(restoredJobs);

    if (isPromiseLike(loaded)) {
      return loaded;
    }

    return Promise.resolve();
  }

  private loadJobs(jobs: WorkflowJob[]): Promise<void> | void {
    const persistedRecoveries: Array<Promise<unknown>> = [];

    for (const job of jobs) {
      if (this.isTerminal(job)) {
        this.jobs.set(job.id, job);
        continue;
      }

      if (job.status === "queued") {
        this.jobs.set(job.id, job);
        this.scheduleProcess();
        continue;
      }

      const restored = {
        ...job,
        status: "failed" as const,
        finishedAt: new Date().toISOString(),
        error: "Job was interrupted by API restart."
      };
      this.jobs.set(restored.id, restored);
      const persisted = this.jobStore?.save(restored);
      if (isPromiseLike(persisted)) {
        persistedRecoveries.push(persisted);
      }
      this.onJobRecovered?.({
        original: job,
        recovered: restored
      });
    }

    this.readyState = true;

    if (persistedRecoveries.length > 0) {
      return Promise.all(persistedRecoveries).then(() => undefined);
    }
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
    this.persist(job);
    this.scheduleProcess();

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

    if (this.activeWorkerCount() >= this.maxConcurrentJobs) {
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
      this.scheduleProcess();
    }
  }

  private scheduleProcess(): void {
    setTimeout(() => {
      this.drainQueuedJobs();
    }, 0);
  }

  private drainQueuedJobs(): void {
    for (const job of this.jobs.values()) {
      if (this.activeWorkerCount() >= this.maxConcurrentJobs) {
        return;
      }

      if (job.status === "queued") {
        void this.process(job.id);
      }
    }
  }

  private activeWorkerCount(): number {
    const activeJobIds = new Set(this.controllers.keys());

    for (const job of this.jobs.values()) {
      if (job.status === "running") {
        activeJobIds.add(job.id);
      }
    }

    return activeJobIds.size;
  }

  private update(job: WorkflowJob, patch: Partial<WorkflowJob>): void {
    Object.assign(job, patch, {
      updatedAt: new Date().toISOString()
    });
    this.jobs.set(job.id, job);
    this.persist(job);

    for (const waiter of this.waiters.get(job.id) ?? []) {
      waiter(job);
    }
  }

  private isTerminal(job: WorkflowJob): boolean {
    return ["completed", "failed", "canceled"].includes(job.status);
  }

  private persist(job: WorkflowJob): void {
    if (!this.jobStore) {
      return;
    }

    const snapshot = { ...job };
    this.pendingPersistence = this.pendingPersistence
      .catch(() => undefined)
      .then(async () => {
        await this.jobStore?.save(snapshot);
      });
    void this.pendingPersistence.catch(() => undefined);
  }
}

function normalizeMaxConcurrentJobs(value: number | undefined): number {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, Math.floor(value));
}

function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
  return Boolean(
    value && typeof (value as Promise<T>).then === "function"
  );
}
