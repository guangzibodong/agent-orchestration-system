import type {
  LocalWorkflowRun,
  QualityGateRunRecord,
  RunnerTaskStatus,
  RunnerWorkflowStatus,
  TaskRunRecord,
  WorkflowReviewRecord
} from "./local-runner.js";
import type {
  DiffArtifact,
  WorktreeWorkspace
} from "./git-worktree-manager.js";
import type { ShellRunResult } from "./shell-adapter.js";

export type PrismaWorkflowRunRow = {
  id: string;
  goal: string;
  status: string;
  executionMode: string;
  repositoryId: string | null;
  repositoryPath: string | null;
  worktreeRoot: string | null;
  reviewDecision: string | null;
  reviewNote: string | null;
  reviewedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  tasks: PrismaWorkflowTaskRunRow[];
  qualityGates: PrismaQualityGateRunRow[];
};

export type PrismaWorkflowTaskRunRow = {
  id: string;
  workflowRunId: string;
  taskId: string;
  title: string;
  status: string;
  agent: string | null;
  command: string | null;
  instructions: string | null;
  cwd: string | null;
  timeoutMs: number | null;
  position: number;
  dependsOn: unknown;
  result: unknown;
  workspace: unknown;
  diff: unknown;
};

export type PrismaQualityGateRunRow = {
  id: string;
  workflowRunId: string;
  gateId: string;
  title: string;
  status: string;
  command: string;
  required?: boolean | null;
  cwd: string | null;
  timeoutMs: number | null;
  position: number;
  result: unknown;
};

type PrismaWorkflowRunWrite = Omit<
  PrismaWorkflowRunRow,
  "tasks" | "qualityGates"
>;

export type PrismaRunStoreClient = {
  workflowRun: {
    findMany(args?: {
      include?: {
        tasks?: {
          orderBy: {
            position: "asc" | "desc";
          };
        };
        qualityGates?: {
          orderBy: {
            position: "asc" | "desc";
          };
        };
      };
      orderBy?: {
        updatedAt: "asc" | "desc";
      };
    }): Promise<PrismaWorkflowRunRow[]>;
    upsert(args: {
      where: {
        id: string;
      };
      create: PrismaWorkflowRunWrite;
      update: Omit<PrismaWorkflowRunWrite, "id">;
    }): Promise<PrismaWorkflowRunRow>;
  };
  workflowTaskRun: {
    deleteMany(args: {
      where: {
        workflowRunId: string;
      };
    }): Promise<unknown>;
    createMany(args: {
      data: PrismaWorkflowTaskRunRow[];
    }): Promise<unknown>;
  };
  qualityGateRun: {
    deleteMany(args: {
      where: {
        workflowRunId: string;
      };
    }): Promise<unknown>;
    createMany(args: {
      data: PrismaQualityGateRunRow[];
    }): Promise<unknown>;
  };
};

export class PrismaRunStore {
  private readonly client: PrismaRunStoreClient;

  constructor(client: PrismaRunStoreClient) {
    this.client = client;
  }

  async list(): Promise<LocalWorkflowRun[]> {
    const rows = await this.client.workflowRun.findMany({
      include: {
        tasks: {
          orderBy: {
            position: "asc"
          }
        },
        qualityGates: {
          orderBy: {
            position: "asc"
          }
        }
      },
      orderBy: {
        updatedAt: "asc"
      }
    });

    return rows.map(toLocalWorkflowRun);
  }

  async save(run: LocalWorkflowRun): Promise<void> {
    const root = toWorkflowRunWrite(run);

    await this.client.workflowRun.upsert({
      where: {
        id: run.id
      },
      create: root,
      update: {
        goal: root.goal,
        status: root.status,
        executionMode: root.executionMode,
        repositoryId: root.repositoryId,
        repositoryPath: root.repositoryPath,
        worktreeRoot: root.worktreeRoot,
        reviewDecision: root.reviewDecision,
        reviewNote: root.reviewNote,
        reviewedAt: root.reviewedAt,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt
      }
    });
    await this.client.workflowTaskRun.deleteMany({
      where: {
        workflowRunId: run.id
      }
    });
    if (run.tasks.length > 0) {
      await this.client.workflowTaskRun.createMany({
        data: run.tasks.map((task, index) => toTaskRow(run.id, task, index))
      });
    }
    await this.client.qualityGateRun.deleteMany({
      where: {
        workflowRunId: run.id
      }
    });
    if (run.qualityGates.length > 0) {
      await this.client.qualityGateRun.createMany({
        data: run.qualityGates.map((gate, index) =>
          toQualityGateRow(run.id, gate, index)
        )
      });
    }
  }
}

function toWorkflowRunWrite(run: LocalWorkflowRun): PrismaWorkflowRunWrite {
  return {
    id: run.id,
    goal: run.goal,
    status: run.status,
    executionMode: run.executionMode,
    repositoryId: run.repositoryId ?? null,
    repositoryPath: run.repositoryPath ?? null,
    worktreeRoot: run.worktreeRoot ?? null,
    reviewDecision: run.review?.decision ?? null,
    reviewNote: run.review?.note ?? null,
    reviewedAt: run.review?.reviewedAt ? new Date(run.review.reviewedAt) : null,
    createdAt: new Date(run.createdAt),
    updatedAt: new Date(run.updatedAt)
  };
}

function toTaskRow(
  workflowRunId: string,
  task: TaskRunRecord,
  position: number
): PrismaWorkflowTaskRunRow {
  return {
    id: `${workflowRunId}:task:${task.id}`,
    workflowRunId,
    taskId: task.id,
    title: task.title,
    status: task.status,
    agent: task.agent,
    command: task.command ?? null,
    instructions: task.instructions ?? null,
    cwd: task.cwd ?? null,
    timeoutMs: task.timeoutMs ?? null,
    position,
    dependsOn: task.dependsOn ?? null,
    result: task.result ?? null,
    workspace: task.workspace ?? null,
    diff: task.diff ?? null
  };
}

function toQualityGateRow(
  workflowRunId: string,
  gate: QualityGateRunRecord,
  position: number
): PrismaQualityGateRunRow {
  return {
    id: `${workflowRunId}:gate:${gate.id}`,
    workflowRunId,
    gateId: gate.id,
    title: gate.title,
    status: gate.status,
    command: gate.command,
    required: gate.required,
    cwd: gate.cwd ?? null,
    timeoutMs: gate.timeoutMs ?? null,
    position,
    result: gate.result ?? null
  };
}

function toLocalWorkflowRun(row: PrismaWorkflowRunRow): LocalWorkflowRun {
  return {
    id: row.id,
    goal: row.goal,
    status: row.status as RunnerWorkflowStatus,
    executionMode: row.executionMode as "direct" | "worktree",
    ...(row.repositoryId ? { repositoryId: row.repositoryId } : {}),
    ...(row.repositoryPath ? { repositoryPath: row.repositoryPath } : {}),
    ...(row.worktreeRoot ? { worktreeRoot: row.worktreeRoot } : {}),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    ...(toWorkflowReview(row) ? { review: toWorkflowReview(row) } : {}),
    tasks: row.tasks
      .slice()
      .sort((left, right) => left.position - right.position)
      .map(toTaskRunRecord),
    qualityGates: row.qualityGates
      .slice()
      .sort((left, right) => left.position - right.position)
      .map(toQualityGateRunRecord)
  };
}

function toTaskRunRecord(row: PrismaWorkflowTaskRunRow): TaskRunRecord {
  return {
    id: row.taskId,
    title: row.title,
    agent: row.agent ?? "",
    ...(row.command ? { command: row.command } : {}),
    ...(row.instructions ? { instructions: row.instructions } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.timeoutMs ? { timeoutMs: row.timeoutMs } : {}),
    ...(toStringArray(row.dependsOn)
      ? { dependsOn: toStringArray(row.dependsOn) }
      : {}),
    status: row.status as RunnerTaskStatus,
    ...(row.result ? { result: row.result as ShellRunResult } : {}),
    ...(row.workspace ? { workspace: row.workspace as WorktreeWorkspace } : {}),
    ...(row.diff ? { diff: row.diff as DiffArtifact } : {})
  };
}

function toQualityGateRunRecord(
  row: PrismaQualityGateRunRow
): QualityGateRunRecord {
  return {
    id: row.gateId,
    title: row.title,
    command: row.command,
    required: row.required ?? true,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.timeoutMs ? { timeoutMs: row.timeoutMs } : {}),
    status: row.status as RunnerTaskStatus,
    ...(row.result ? { result: row.result as ShellRunResult } : {})
  };
}

function toWorkflowReview(
  row: PrismaWorkflowRunRow
): WorkflowReviewRecord | undefined {
  if (!row.reviewDecision || !row.reviewedAt) {
    return undefined;
  }

  return {
    decision: row.reviewDecision as WorkflowReviewRecord["decision"],
    ...(row.reviewNote ? { note: row.reviewNote } : {}),
    reviewedAt: toIsoString(row.reviewedAt)
  };
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
