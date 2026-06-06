import { describe, expect, it } from "vitest";
import { PrismaRunStore } from "./prisma-run-store.js";
import type { LocalWorkflowRun } from "./local-runner.js";

type WorkflowRunRow = {
  id: string;
  goal: string;
  status: string;
  executionMode: string;
  repositoryId: string | null;
  repositoryPath: string | null;
  worktreeRoot: string | null;
  reviewDecision: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tasks: TaskRow[];
  qualityGates: GateRow[];
};

type TaskRow = {
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

type GateRow = {
  id: string;
  workflowRunId: string;
  gateId: string;
  title: string;
  status: string;
  command: string;
  cwd: string | null;
  timeoutMs: number | null;
  position: number;
  result: unknown;
};

function createRunClient() {
  const rows: WorkflowRunRow[] = [];

  return {
    rows,
    workflowRun: {
      async findMany() {
        return [...rows].sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
      },
      async upsert(args: {
        where: { id: string };
        create: Omit<WorkflowRunRow, "tasks" | "qualityGates">;
        update: Omit<WorkflowRunRow, "id" | "tasks" | "qualityGates">;
      }) {
        const existing = rows.find((row) => row.id === args.where.id);

        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }

        const row = {
          ...args.create,
          tasks: [],
          qualityGates: []
        };
        rows.push(row);
        return row;
      }
    },
    workflowTaskRun: {
      async deleteMany(args: { where: { workflowRunId: string } }) {
        const row = rows.find((current) => current.id === args.where.workflowRunId);
        if (row) {
          row.tasks = [];
        }
      },
      async createMany(args: { data: TaskRow[] }) {
        for (const task of args.data) {
          const row = rows.find((current) => current.id === task.workflowRunId);
          row?.tasks.push(task);
        }
      }
    },
    qualityGateRun: {
      async deleteMany(args: { where: { workflowRunId: string } }) {
        const row = rows.find((current) => current.id === args.where.workflowRunId);
        if (row) {
          row.qualityGates = [];
        }
      },
      async createMany(args: { data: GateRow[] }) {
        for (const gate of args.data) {
          const row = rows.find((current) => current.id === gate.workflowRunId);
          row?.qualityGates.push(gate);
        }
      }
    }
  };
}

describe("PrismaRunStore", () => {
  it("saves workflow runs with tasks gates review and worktree metadata", async () => {
    const client = createRunClient();
    const store = new PrismaRunStore(client);
    const run: LocalWorkflowRun = {
      id: "workflow-1",
      goal: "Ship database runtime",
      status: "needs_review",
      executionMode: "worktree",
      repositoryId: "repo-1",
      repositoryPath: "C:/repo",
      worktreeRoot: "C:/repo/.worktrees",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:10:00.000Z",
      review: {
        decision: "approved",
        note: "Looks good",
        reviewedAt: "2026-06-05T00:11:00.000Z"
      },
      tasks: [
        {
          id: "plan",
          title: "Plan",
          agent: "codex",
          instructions: "Split the work",
          dependsOn: ["setup"],
          status: "passed",
          workspace: {
            path: "C:/repo/.worktrees/plan",
            branch: "mawo/plan",
            repoPath: "C:/repo"
          },
          diff: {
            status: "M README.md",
            patch: "diff --git a/README.md b/README.md",
          }
        }
      ],
      qualityGates: [
        {
          id: "test",
          title: "Tests",
          command: "npm test",
          status: "passed",
          result: {
            command: "npm test",
            status: "passed",
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 42,
            startedAt: "2026-06-05T00:09:00.000Z",
            finishedAt: "2026-06-05T00:09:01.000Z"
          }
        }
      ]
    };

    await store.save(run);

    expect(client.rows).toEqual([
      expect.objectContaining({
        id: "workflow-1",
        goal: "Ship database runtime",
        status: "needs_review",
        executionMode: "worktree",
        repositoryId: "repo-1",
        reviewDecision: "approved",
        tasks: [
          expect.objectContaining({
            taskId: "plan",
            position: 0,
            dependsOn: ["setup"],
            workspace: expect.objectContaining({
              branch: "mawo/plan"
            })
          })
        ],
        qualityGates: [
          expect.objectContaining({
            gateId: "test",
            position: 0,
            result: expect.objectContaining({
              exitCode: 0
            })
          })
        ]
      })
    ]);
  });

  it("lists saved workflow runs reconstructed as LocalWorkflowRun records", async () => {
    const client = createRunClient();
    const store = new PrismaRunStore(client);
    const run: LocalWorkflowRun = {
      id: "workflow-1",
      goal: "Restore runtime",
      status: "ready",
      executionMode: "direct",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      tasks: [
        {
          id: "implement",
          title: "Implement",
          agent: "shell",
          command: "echo ok",
          timeoutMs: 1000,
          status: "waiting"
        }
      ],
      qualityGates: []
    };

    await store.save(run);

    await expect(store.list()).resolves.toEqual([run]);
  });

  it("lets a runner refresh workflow state written by another process", async () => {
    const client = createRunClient();
    const store = new PrismaRunStore(client);
    const initial: LocalWorkflowRun = {
      id: "workflow-1",
      goal: "External worker sync",
      status: "ready",
      executionMode: "direct",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      tasks: [
        {
          id: "implement",
          title: "Implement",
          agent: "shell",
          command: "echo ok",
          status: "waiting"
        }
      ],
      qualityGates: []
    };
    const externallyCompleted: LocalWorkflowRun = {
      ...initial,
      status: "needs_review",
      updatedAt: "2026-06-05T00:05:00.000Z",
      tasks: [
        {
          ...initial.tasks[0]!,
          status: "passed"
        }
      ]
    };

    await store.save(initial);
    await store.save(externallyCompleted);

    await expect(store.list()).resolves.toEqual([externallyCompleted]);
  });
});
