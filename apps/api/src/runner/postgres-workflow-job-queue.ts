import { randomUUID } from "node:crypto";
import type { JobStore } from "./file-job-store.js";
import {
  WorkflowAlreadyRunningError,
  type WorkflowJob
} from "./workflow-job-queue.js";

export type PostgresWorkflowJobQueueOptions = {
  jobStore: JobStore;
};

export class PostgresWorkflowJobQueue {
  private readonly jobStore: JobStore;

  constructor(options: PostgresWorkflowJobQueueOptions) {
    this.jobStore = options.jobStore;
  }

  async ready(): Promise<void> {
    await this.jobStore.list();
  }

  async flush(): Promise<void> {
    return;
  }

  async enqueue(workflowId: string): Promise<WorkflowJob> {
    const activeJob = await this.getActiveJobForWorkflow(workflowId);

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

    await this.jobStore.save(job);

    return job;
  }

  async listJobs(): Promise<WorkflowJob[]> {
    return await this.jobStore.list();
  }

  async getJob(id: string): Promise<WorkflowJob | undefined> {
    return (await this.listJobs()).find((job) => job.id === id);
  }

  async getActiveJobForWorkflow(
    workflowId: string
  ): Promise<WorkflowJob | undefined> {
    return (await this.listJobs()).find(
      (job) =>
        job.workflowId === workflowId &&
        (job.status === "queued" || job.status === "running")
    );
  }

  async cancelJob(id: string): Promise<WorkflowJob | undefined> {
    const job = await this.getJob(id);

    if (!job) {
      return undefined;
    }

    if (isTerminal(job)) {
      return job;
    }

    const now = new Date().toISOString();
    const canceled: WorkflowJob = {
      ...job,
      status: "canceled",
      updatedAt: now,
      finishedAt: now
    };

    await this.jobStore.save(canceled);

    return canceled;
  }
}

function isTerminal(job: WorkflowJob): boolean {
  return ["completed", "failed", "canceled"].includes(job.status);
}
