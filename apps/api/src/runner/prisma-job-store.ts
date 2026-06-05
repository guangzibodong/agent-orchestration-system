import { workflowJobSchema } from "@mawo/shared";
import type { WorkflowJob } from "./workflow-job-queue.js";

export type PrismaWorkflowJobRow = {
  id: string;
  workflowRunId: string;
  status: string;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
};

export type PrismaJobStoreClient = {
  workflowJob: {
    findMany(args?: {
      orderBy?: {
        updatedAt: "asc" | "desc";
      };
    }): Promise<PrismaWorkflowJobRow[]>;
    upsert(args: {
      where: {
        id: string;
      };
      create: PrismaWorkflowJobRow;
      update: Omit<PrismaWorkflowJobRow, "id">;
    }): Promise<PrismaWorkflowJobRow>;
  };
};

export class PrismaJobStore {
  private readonly client: PrismaJobStoreClient;

  constructor(client: PrismaJobStoreClient) {
    this.client = client;
  }

  async list(): Promise<WorkflowJob[]> {
    const rows = await this.client.workflowJob.findMany({
      orderBy: {
        updatedAt: "asc"
      }
    });

    return rows.map(toWorkflowJob);
  }

  async save(job: WorkflowJob): Promise<void> {
    const row = toWorkflowJobRow(job);

    await this.client.workflowJob.upsert({
      where: {
        id: job.id
      },
      create: row,
      update: {
        workflowRunId: row.workflowRunId,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt
      }
    });
  }
}

function toWorkflowJobRow(job: WorkflowJob): PrismaWorkflowJobRow {
  return {
    id: job.id,
    workflowRunId: job.workflowId,
    status: job.status,
    error: job.error ?? null,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
    startedAt: job.startedAt ? new Date(job.startedAt) : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null
  };
}

function toWorkflowJob(row: PrismaWorkflowJobRow): WorkflowJob {
  return workflowJobSchema.parse({
    id: row.id,
    workflowId: row.workflowRunId,
    status: row.status,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    startedAt: row.startedAt ? toIsoString(row.startedAt) : undefined,
    finishedAt: row.finishedAt ? toIsoString(row.finishedAt) : undefined,
    error: row.error ?? undefined
  });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
