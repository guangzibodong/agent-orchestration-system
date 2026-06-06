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
  lockedBy: string | null;
  lockedAt: Date | string | null;
  leaseExpiresAt: Date | string | null;
  attempts: number;
};

type PrismaWorkflowJobUpdate = Omit<
  PrismaWorkflowJobRow,
  "id" | "attempts"
>;

export type ClaimNextQueuedJobInput = {
  workerId: string;
  now: Date;
  leaseExpiresAt: Date;
};

export type RenewJobLeaseInput = ClaimNextQueuedJobInput & {
  jobId: string;
};

export type FinishClaimedJobInput = {
  job: WorkflowJob;
  workerId: string;
};

export type PrismaJobStoreClient = {
  workflowJob: {
    findMany(args?: {
      orderBy?: {
        updatedAt: "asc" | "desc";
      };
    }): Promise<PrismaWorkflowJobRow[]>;
    findFirst(args: {
      where: {
        status: string;
      };
      orderBy: {
        createdAt: "asc";
      };
    }): Promise<PrismaWorkflowJobRow | null>;
    findUnique(args: {
      where: {
        id: string;
      };
    }): Promise<PrismaWorkflowJobRow | null>;
    updateMany(args: {
      where: {
        id: string;
        status: string;
        lockedBy?: string;
      };
      data: Partial<PrismaWorkflowJobUpdate> & {
        attempts?: {
          increment: number;
        };
      };
    }): Promise<{ count: number }>;
    upsert(args: {
      where: {
        id: string;
      };
      create: PrismaWorkflowJobRow;
      update: PrismaWorkflowJobUpdate;
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

  async getJob(id: string): Promise<WorkflowJob | undefined> {
    const row = await this.client.workflowJob.findUnique({
      where: {
        id
      }
    });

    return row ? toWorkflowJob(row) : undefined;
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
        finishedAt: row.finishedAt,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null
      }
    });
  }

  async claimNextQueuedJob(
    input: ClaimNextQueuedJobInput
  ): Promise<WorkflowJob | undefined> {
    const candidate = await this.client.workflowJob.findFirst({
      where: {
        status: "queued"
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!candidate) {
      return undefined;
    }

    const claimed = await this.client.workflowJob.updateMany({
      where: {
        id: candidate.id,
        status: "queued"
      },
      data: {
        workflowRunId: candidate.workflowRunId,
        status: "running",
        error: null,
        createdAt: candidate.createdAt,
        updatedAt: input.now,
        startedAt: input.now,
        finishedAt: null,
        lockedBy: input.workerId,
        lockedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        attempts: {
          increment: 1
        }
      }
    });

    if (claimed.count !== 1) {
      return undefined;
    }

    const row = await this.client.workflowJob.findUnique({
      where: {
        id: candidate.id
      }
    });

    return row ? toWorkflowJob(row) : undefined;
  }

  async renewJobLease(input: RenewJobLeaseInput): Promise<boolean> {
    const updated = await this.client.workflowJob.updateMany({
      where: {
        id: input.jobId,
        status: "running",
        lockedBy: input.workerId
      },
      data: {
        updatedAt: input.now,
        lockedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt
      }
    });

    return updated.count === 1;
  }

  async finishClaimedJob(
    input: FinishClaimedJobInput
  ): Promise<WorkflowJob | undefined> {
    const row = toWorkflowJobRow(input.job);
    const updated = await this.client.workflowJob.updateMany({
      where: {
        id: input.job.id,
        status: "running",
        lockedBy: input.workerId
      },
      data: {
        workflowRunId: row.workflowRunId,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null
      }
    });

    if (updated.count !== 1) {
      return undefined;
    }

    return await this.getJob(input.job.id);
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
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null,
    attempts: 0
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
