import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { AuditEvent, RepositoryRegistrationRequest } from "@mawo/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./server.js";
import type { AuditEventInput, AuditStore } from "./runner/file-audit-store.js";
import type { JobStore } from "./runner/file-job-store.js";
import type { RunStore } from "./runner/file-run-store.js";
import type { PrismaAuditEventRow } from "./runner/prisma-audit-store.js";
import type { PrismaWorkflowJobRow } from "./runner/prisma-job-store.js";
import type {
  RepositoryStore,
  RepositoryUpsertResult,
} from "./runner/file-repository-store.js";
import { LocalRunner, type LocalWorkflowRun } from "./runner/local-runner.js";
import { ShellAdapter } from "./runner/shell-adapter.js";
import type { WorkflowJob } from "./runner/workflow-job-queue.js";

type PrismaWorkflowJobWhere = {
  id?: string;
  status?: string;
  lockedBy?: string;
  leaseExpiresAt?: {
    lte: Date;
  };
  OR?: Array<{
    status: string;
    leaseExpiresAt?: {
      lte: Date;
    };
  }>;
};

const tempRoots: string[] = [];
const node = JSON.stringify(process.execPath);
const shell = new ShellAdapter();

async function run(command: string, cwd: string) {
  const result = await shell.run({ command, cwd });

  if (result.status !== "passed") {
    throw new Error(
      result.stderr || result.stdout || `Command failed: ${command}`,
    );
  }

  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForJobStatus(
  app: ReturnType<typeof buildApp>,
  jobId: string,
  status: "canceled" | "completed" | "failed",
) {
  let response = await app.inject({
    method: "GET",
    url: `/jobs/${jobId}`,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (response.json().status === status) {
      return response;
    }

    await delay(250);
    response = await app.inject({
      method: "GET",
      url: `/jobs/${jobId}`,
    });
  }

  return response;
}

function matchesWorkflowJobWhere(
  row: PrismaWorkflowJobRow,
  where: PrismaWorkflowJobWhere,
): boolean {
  if (where.OR) {
    return where.OR.some((condition) =>
      matchesWorkflowJobWhere(row, condition),
    );
  }

  if (where.id && row.id !== where.id) {
    return false;
  }

  if (where.status && row.status !== where.status) {
    return false;
  }

  if (where.lockedBy !== undefined && row.lockedBy !== where.lockedBy) {
    return false;
  }

  if (where.leaseExpiresAt) {
    if (!row.leaseExpiresAt) {
      return false;
    }

    if (
      new Date(row.leaseExpiresAt).getTime() >
      where.leaseExpiresAt.lte.getTime()
    ) {
      return false;
    }
  }

  return true;
}

function createEmptyPrismaStateClient() {
  return {
    repositoryRecord: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workflowRun: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(),
    },
    workflowTaskRun: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    qualityGateRun: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    workflowJob: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(),
    },
    auditEvent: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
    },
  };
}

function createMutablePrismaStateClient(
  input: {
    workflowJobs?: PrismaWorkflowJobRow[];
  } = {},
) {
  const workflowJobs = [...(input.workflowJobs ?? [])];
  const auditEvents: PrismaAuditEventRow[] = [];
  const prismaClient = {
    ...createEmptyPrismaStateClient(),
    workflowJob: {
      findMany: vi.fn(async () =>
        [...workflowJobs].sort(
          (left, right) =>
            new Date(left.updatedAt).getTime() -
            new Date(right.updatedAt).getTime(),
        ),
      ),
      findFirst: vi.fn(
        async (args: {
          where: PrismaWorkflowJobWhere;
          orderBy: { createdAt: "asc" };
        }) =>
          [...workflowJobs]
            .filter((job) => matchesWorkflowJobWhere(job, args.where))
            .sort(
              (left, right) =>
                new Date(left.createdAt).getTime() -
                new Date(right.createdAt).getTime(),
            )[0] ?? null,
      ),
      findUnique: vi.fn(
        async (args: { where: { id: string } }) =>
          workflowJobs.find((job) => job.id === args.where.id) ?? null,
      ),
      updateMany: vi.fn(
        async (args: {
          where: PrismaWorkflowJobWhere;
          data: Partial<Omit<PrismaWorkflowJobRow, "id" | "attempts">> & {
            attempts?: { increment: number };
          };
        }) => {
          const index = workflowJobs.findIndex((job) =>
            matchesWorkflowJobWhere(job, args.where),
          );

          if (index < 0) {
            return { count: 0 };
          }

          const existing = workflowJobs[index]!;
          workflowJobs[index] = {
            ...existing,
            ...args.data,
            attempts: existing.attempts + (args.data.attempts?.increment ?? 0),
          };

          return { count: 1 };
        },
      ),
      upsert: vi.fn(
        async (args: {
          where: { id: string };
          create: PrismaWorkflowJobRow;
          update: Omit<PrismaWorkflowJobRow, "id" | "attempts">;
        }) => {
          const index = workflowJobs.findIndex(
            (job) => job.id === args.where.id,
          );

          if (index < 0) {
            workflowJobs.push(args.create);
            return args.create;
          }

          workflowJobs[index] = {
            ...workflowJobs[index]!,
            ...args.update,
          };

          return workflowJobs[index]!;
        },
      ),
    },
    auditEvent: {
      findMany: vi.fn(async () => auditEvents),
      create: vi.fn(
        async (args: {
          data: {
            id?: string;
            type: string;
            actor: string | null;
            workflowRunId: string | null;
            jobId: string | null;
            metadata: unknown;
            createdAt?: Date;
          };
        }) => {
          const row = {
            id: args.data.id ?? `audit-${auditEvents.length + 1}`,
            type: args.data.type,
            actor: args.data.actor,
            workflowRunId: args.data.workflowRunId,
            jobId: args.data.jobId,
            metadata: args.data.metadata,
            createdAt: args.data.createdAt ?? new Date(),
          };
          auditEvents.push(row);
          return row;
        },
      ),
    },
  };

  return {
    auditEvents,
    prismaClient,
    workflowJobs,
  };
}

async function createCommittedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-server-repo-test-"));
  tempRoots.push(repoPath);

  await run("git init -b main", repoPath);
  await run('git config user.email "test@example.com"', repoPath);
  await run('git config user.name "MAWO Test"', repoPath);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  await run("git add README.md", repoPath);
  await run('git commit -m "initial commit"', repoPath);

  return repoPath;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();

  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("runner API", () => {
  it("requires bearer auth for protected endpoints when an API token is configured", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_API_TOKEN: "secret-token",
      },
    });

    const healthResponse = await app.inject({
      method: "GET",
      url: "/health",
    });
    const rejectedResponse = await app.inject({
      method: "GET",
      url: "/workflows",
    });
    const acceptedResponse = await app.inject({
      method: "GET",
      url: "/workflows",
      headers: {
        authorization: "Bearer secret-token",
      },
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(rejectedResponse.statusCode).toBe(401);
    expect(rejectedResponse.json()).toMatchObject({
      error: "unauthorized",
    });
    expect(acceptedResponse.statusCode).toBe(200);
  });

  it("allows a viewer token to read operational endpoints", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-viewer-auth-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_API_TOKEN: "operator-token",
        MAWO_VIEWER_API_TOKEN: "viewer-token",
      },
    });
    const viewerHeaders = {
      authorization: "Bearer viewer-token",
    };
    const requests = [
      { method: "GET", url: "/readiness" },
      { method: "GET", url: "/agents" },
      { method: "GET", url: "/agents/health" },
      { method: "GET", url: "/workers/health" },
      { method: "GET", url: "/operations/snapshot" },
      { method: "GET", url: "/launch/evidence/latest" },
      { method: "GET", url: "/repositories" },
      { method: "GET", url: "/repositories/missing-repository/safety" },
      { method: "GET", url: "/requirements" },
      { method: "GET", url: "/requirements/missing-requirement" },
      { method: "GET", url: "/requirements/missing-requirement/report" },
      {
        method: "GET",
        url: "/requirements/missing-requirement/merge-candidate",
      },
      { method: "GET", url: "/workflows" },
      { method: "GET", url: "/workflows/missing-workflow" },
      { method: "GET", url: "/workflows/missing-workflow/report" },
      {
        method: "GET",
        url: "/workflows/missing-workflow/artifact?path=report.json",
      },
      { method: "GET", url: "/workflows/missing-workflow/merge-candidate" },
      { method: "GET", url: "/workflows/missing-workflow/workspaces" },
      { method: "GET", url: "/jobs" },
      { method: "GET", url: "/jobs/missing-job" },
      { method: "GET", url: "/jobs/missing-job/timeline" },
      { method: "GET", url: "/audit-events" },
    ] as const;

    const responses = await Promise.all(
      requests.map((request) =>
        app.inject({
          ...request,
          headers: viewerHeaders,
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200, 404, 200, 404, 200, 404, 404, 404, 200, 404,
      404, 404, 404, 404, 200, 404, 404, 200,
    ]);
  });

  it("returns the latest local launch gate evidence as a viewer-readable endpoint", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-launch-evidence-test-"));
    tempRoots.push(demoRoot);
    const evidenceRoot = join(demoRoot, "output", "launch-readiness");
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(
      join(evidenceRoot, "2026-06-06T16-20-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-06-06T16:20:00.000Z",
        root: demoRoot,
        branch: "main",
        commit: "old",
        dirtyFiles: [],
        checks: [],
        docs: [],
        localDecision: "failed",
        productionDecision: "blocked",
        failureSummaries: ["old failure"],
        externalBlockers: [],
      }),
      "utf8",
    );
    await writeFile(
      join(evidenceRoot, "2026-06-06T16-35-25-938Z.json"),
      JSON.stringify({
        generatedAt: "2026-06-06T16:35:25.938Z",
        root: demoRoot,
        branch: "main",
        commit: "cfa22af",
        dirtyFiles: [],
        checks: [
          {
            id: "typecheck",
            label: "Typecheck",
            required: true,
            command: "npm.cmd",
            args: ["run", "typecheck"],
            status: "passed",
            exitCode: 0,
            durationMs: 4958,
          },
        ],
        docs: ["docs/product/REQUIREMENTS_FREEZE.md"],
        localDecision: "passed",
        productionDecision: "blocked",
        failureSummaries: [],
        externalBlockers: [
          "smoke_api_postgres: DATABASE_URL is not configured.",
        ],
      }),
      "utf8",
    );
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_API_TOKEN: "operator-token",
        MAWO_VIEWER_API_TOKEN: "viewer-token",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/launch/evidence/latest",
      headers: {
        authorization: "Bearer viewer-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      generatedAt: "2026-06-06T16:35:25.938Z",
      localDecision: "passed",
      productionDecision: "blocked",
      sourcePath: expect.stringContaining("2026-06-06T16-35-25-938Z.json"),
    });
  });

  it("marks launch gate evidence stale when it does not match the current git state", async () => {
    const repoPath = await createCommittedRepo();
    const head = (await run("git rev-parse --short HEAD", repoPath)).stdout.trim();
    const evidenceRoot = join(repoPath, "output", "launch-readiness");
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(
      join(evidenceRoot, "2026-06-06T16-35-25-938Z.json"),
      JSON.stringify({
        generatedAt: "2026-06-06T16:35:25.938Z",
        root: repoPath,
        branch: "main",
        commit: "old-commit",
        dirtyFiles: [],
        checks: [],
        docs: ["docs/product/REQUIREMENTS_FREEZE.md"],
        localDecision: "passed",
        productionDecision: "blocked",
        failureSummaries: [],
        externalBlockers: [],
      }),
      "utf8",
    );
    await writeFile(join(repoPath, "UNCOMMITTED.md"), "dirty\n", "utf8");
    const app = buildApp(undefined, { demoRoot: repoPath });

    const response = await app.inject({
      method: "GET",
      url: "/launch/evidence/latest",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      commit: "old-commit",
      currentCommit: head,
      currentBranch: "main",
      fresh: false,
      currentDirtyFiles: expect.arrayContaining([
        expect.stringContaining("UNCOMMITTED.md"),
      ]),
      staleReasons: [
        expect.stringContaining("commit"),
        expect.stringContaining("working tree"),
      ],
    });
  });

  it("blocks a viewer token from mutating repositories, workflows, jobs, and merge candidates", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_API_TOKEN: "operator-token",
        MAWO_VIEWER_API_TOKEN: "viewer-token",
      },
    });
    const viewerHeaders = {
      authorization: "Bearer viewer-token",
    };
    const requests = [
      { method: "POST", url: "/repositories", payload: {} },
      { method: "DELETE", url: "/repositories/missing-repository" },
      { method: "POST", url: "/requirements", payload: {} },
      {
        method: "PATCH",
        url: "/requirements/missing-requirement",
        payload: {},
      },
      { method: "POST", url: "/requirements/missing-requirement/confirm-plan" },
      { method: "POST", url: "/requirements/missing-requirement/enqueue" },
      { method: "POST", url: "/requirements/missing-requirement/retry" },
      { method: "POST", url: "/workflows/demo" },
      { method: "POST", url: "/workflows/worktree-demo" },
      { method: "POST", url: "/workflows/agent-demo" },
      { method: "POST", url: "/workflows/repository", payload: {} },
      {
        method: "POST",
        url: "/workflows/missing-workflow/review",
        payload: {},
      },
      { method: "POST", url: "/workflows/missing-workflow/run" },
      { method: "POST", url: "/workflows/missing-workflow/retry" },
      { method: "POST", url: "/workflows/missing-workflow/enqueue" },
      { method: "POST", url: "/workflows/missing-workflow/workspaces/cleanup" },
      {
        method: "POST",
        url: "/workflows/missing-workflow/merge-candidate/apply",
      },
      { method: "POST", url: "/jobs/missing-job/cancel" },
    ] as const;

    const responses = await Promise.all(
      requests.map((request) =>
        app.inject({
          ...request,
          headers: viewerHeaders,
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: "forbidden",
        message: "This endpoint requires an operator token.",
        requiredRole: "operator",
        role: "viewer",
      });
    }
  });

  it("keeps operator token access for mutating endpoints when a viewer token is configured", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_API_TOKEN: "operator-token",
        MAWO_VIEWER_API_TOKEN: "viewer-token",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/workflows/demo",
      headers: {
        authorization: "Bearer operator-token",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      status: "ready",
    });
  });

  it("protects write endpoints when only a viewer token is configured", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_VIEWER_API_TOKEN: "viewer-token",
      },
    });

    const unauthenticatedRead = await app.inject({
      method: "GET",
      url: "/workflows",
    });
    const viewerRead = await app.inject({
      method: "GET",
      url: "/workflows",
      headers: {
        authorization: "Bearer viewer-token",
      },
    });
    const viewerWrite = await app.inject({
      method: "POST",
      url: "/workflows/demo",
      headers: {
        authorization: "Bearer viewer-token",
      },
    });

    expect(unauthenticatedRead.statusCode).toBe(401);
    expect(viewerRead.statusCode).toBe(200);
    expect(viewerWrite.statusCode).toBe(403);
    expect(viewerWrite.json()).toMatchObject({
      error: "forbidden",
      requiredRole: "operator",
      role: "viewer",
    });
  });

  it("creates, updates, lists, gets, and confirms requirement delivery tickets", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirements-api-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Deliver safe README change",
      },
    });
    const draft = createResponse.json();
    const blockedConfirmResponse = await app.inject({
      method: "POST",
      url: `/requirements/${draft.id}/confirm-plan`,
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/requirements/${draft.id}`,
      payload: {
        repositoryPath: "C:/repo",
        goal: "Produce an isolated, reviewable patch",
        acceptanceCriteria: ["README explains the manual apply path"],
        constraints: ["Do not auto-merge"],
        nonGoals: ["Do not create a PR"],
        riskLevel: "medium",
        contextPaths: ["README.md"],
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: "node scripts/edit-readme.js",
          },
        ],
        qualityGates: [
          {
            id: "tests",
            title: "Unit tests",
            command: "npm test",
          },
        ],
      },
    });
    const planned = patchResponse.json();
    const listResponse = await app.inject({
      method: "GET",
      url: "/requirements",
    });
    const getResponse = await app.inject({
      method: "GET",
      url: `/requirements/${draft.id}`,
    });
    const confirmResponse = await app.inject({
      method: "POST",
      url: `/requirements/${draft.id}/confirm-plan`,
    });
    const confirmed = confirmResponse.json();
    const restoredApp = buildApp(undefined, { demoRoot });
    const restoredResponse = await restoredApp.inject({
      method: "GET",
      url: `/requirements/${draft.id}`,
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/requirements/${draft.id}/report`,
    });
    const mergeCandidateResponse = await app.inject({
      method: "GET",
      url: `/requirements/${draft.id}/merge-candidate`,
    });
    const workflowsResponse = await app.inject({
      method: "GET",
      url: "/workflows",
    });

    expect(createResponse.statusCode).toBe(201);
    expect(draft).toMatchObject({
      title: "Deliver safe README change",
      status: "needs_clarification",
      acceptanceCriteria: [],
      tasks: [],
      qualityGates: [],
    });
    expect(blockedConfirmResponse.statusCode).toBe(409);
    expect(blockedConfirmResponse.json()).toMatchObject({
      error: "requirement_plan_not_ready",
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(planned).toMatchObject({
      id: draft.id,
      status: "plan_review",
      repositoryPath: "C:/repo",
      goal: "Produce an isolated, reviewable patch",
    });
    expect(planned.qualityGates[0]).toMatchObject({
      id: "tests",
      required: true,
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([planned]);
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual(planned);
    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmed).toMatchObject({
      id: draft.id,
      status: "ready_to_run",
    });
    expect(restoredResponse.statusCode).toBe(200);
    expect(restoredResponse.json()).toEqual(confirmed);
    expect(reportResponse.statusCode).toBe(409);
    expect(reportResponse.json()).toMatchObject({
      error: "requirement_report_not_ready",
      status: "ready_to_run",
    });
    expect(mergeCandidateResponse.statusCode).toBe(409);
    expect(mergeCandidateResponse.json()).toMatchObject({
      error: "requirement_merge_candidate_not_ready",
      status: "ready_to_run",
    });
    expect(workflowsResponse.statusCode).toBe(200);
    expect(workflowsResponse.json()).toEqual([]);
  });

  it("enqueues confirmed requirements as repository workflows and links run evidence", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-enqueue-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Deliver safe README change",
        repositoryPath: repoPath,
        goal: "Produce an isolated, reviewable patch",
        acceptanceCriteria: ["README explains the manual apply path"],
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','requirement\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "tests",
            title: "Unit tests",
            command: `${node} -e "process.exit(0)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    const enqueueBody = enqueueResponse.json();
    const linkedRequirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });
    const workflowsResponse = await app.inject({
      method: "GET",
      url: "/workflows",
    });
    let completedJobResponse = await app.inject({
      method: "GET",
      url: `/jobs/${enqueueBody.job.id}`,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (completedJobResponse.json().status === "completed") {
        break;
      }

      await delay(250);
      completedJobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${enqueueBody.job.id}`,
      });
    }

    expect(enqueueResponse.statusCode).toBe(202);
    expect(enqueueBody).toMatchObject({
      requirement: {
        id: requirement.id,
        status: "running",
        currentWorkflowRunId: expect.any(String),
        runLinks: [
          expect.objectContaining({
            workflowRunId: expect.any(String),
            status: "ready",
          }),
        ],
      },
      workflow: {
        status: "ready",
        repositoryPath: repoPath,
      },
      job: {
        status: "queued",
        workflowId: expect.any(String),
      },
    });
    expect(enqueueBody.job.workflowId).toBe(enqueueBody.workflow.id);
    expect(enqueueBody.requirement.currentWorkflowRunId).toBe(
      enqueueBody.workflow.id,
    );
    expect(linkedRequirementResponse.json()).toEqual(enqueueBody.requirement);
    expect(workflowsResponse.json()).toEqual([
      expect.objectContaining({
        id: enqueueBody.workflow.id,
        repositoryPath: repoPath,
      }),
    ]);
    expect(completedJobResponse.json()).toMatchObject({
      id: enqueueBody.job.id,
      status: "completed",
    });
  });

  it("syncs linked requirements to needs_rework when workflow gates fail", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-sync-failed-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Sync failed gate requirement",
        repositoryPath: repoPath,
        goal: "Show failed gates as requirement rework",
        acceptanceCriteria: ["Requirement status follows the failed gate"],
        tasks: [
          {
            id: "patch",
            title: "Patch README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','sync failed\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "gate",
            title: "Failing gate",
            command: `${node} -e "process.exit(1)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    const enqueueBody = enqueueResponse.json();

    let completedJobResponse = await app.inject({
      method: "GET",
      url: `/jobs/${enqueueBody.job.id}`,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (completedJobResponse.json().status === "completed") {
        break;
      }

      await delay(250);
      completedJobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${enqueueBody.job.id}`,
      });
    }

    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${enqueueBody.workflow.id}`,
    });
    const requirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });
    const mergeCandidateResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/merge-candidate`,
    });

    expect(completedJobResponse.json()).toMatchObject({ status: "completed" });
    expect(workflowResponse.json()).toMatchObject({ status: "gate_failed" });
    expect(requirementResponse.json()).toMatchObject({
      id: requirement.id,
      status: "needs_rework",
      currentWorkflowRunId: enqueueBody.workflow.id,
      runLinks: [
        expect.objectContaining({
          workflowRunId: enqueueBody.workflow.id,
          status: "gate_failed",
        }),
      ],
    });
    expect(mergeCandidateResponse.statusCode).toBe(409);
    expect(mergeCandidateResponse.json()).toMatchObject({
      error: "requirement_merge_candidate_not_ready",
    });
  });

  it("rejects concurrent requirement enqueue before a duplicate workflow is created", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-concurrent-enqueue-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    let releaseFirstSafety!: () => void;
    let resolveFirstSafetyStarted!: () => void;
    let safetyCalls = 0;
    const firstSafetyStarted = new Promise<void>((resolve) => {
      resolveFirstSafetyStarted = resolve;
    });
    const firstSafetyRelease = new Promise<void>((resolve) => {
      releaseFirstSafety = resolve;
    });
    const app = buildApp(undefined, {
      demoRoot,
      repositorySafetyInspector: async () => {
        safetyCalls += 1;

        if (safetyCalls === 1) {
          resolveFirstSafetyStarted();
          await firstSafetyRelease;
        }

        return {
          repositoryId: "repo-concurrent",
          path: repoPath,
          clean: true,
          dirty: false,
          allowedRoot: true,
          noAutoMerge: true,
          manualApplyPolicy: "Manual git apply only",
        };
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Prevent duplicate requirement enqueue",
        repositoryPath: repoPath,
        goal: "Create exactly one workflow for an enqueue request",
        acceptanceCriteria: ["Concurrent enqueue creates no orphan workflow"],
        tasks: [
          {
            id: "patch",
            title: "Patch README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','concurrent enqueue\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "gate",
            title: "Passing gate",
            command: `${node} -e "process.exit(0)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });

    const firstEnqueue = app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    await firstSafetyStarted;
    const secondResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    releaseFirstSafety();
    const firstResponse = await firstEnqueue;
    const firstBody = firstResponse.json();
    const secondBody = secondResponse.json();

    if (typeof firstBody.job?.id === "string") {
      await waitForJobStatus(app, firstBody.job.id, "completed");
    }

    if (typeof secondBody.job?.id === "string") {
      await waitForJobStatus(app, secondBody.job.id, "completed");
    }

    const workflowsResponse = await app.inject({
      method: "GET",
      url: "/workflows",
    });
    const createdWorkflows = workflowsResponse
      .json()
      .filter(
        (workflow: { goal?: string }) =>
          workflow.goal === "Create exactly one workflow for an enqueue request",
      );

    expect(firstResponse.statusCode).toBe(202);
    expect(secondResponse.statusCode).toBe(409);
    expect(secondBody).toMatchObject({
      error: "requirement_enqueue_in_progress",
    });
    expect(safetyCalls).toBe(1);
    expect(createdWorkflows).toHaveLength(1);
  });

  it("syncs linked requirements to needs_review with report and merge candidate evidence", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-sync-review-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Sync review-ready requirement",
        repositoryPath: repoPath,
        goal: "Produce a reviewable merge candidate from a requirement",
        acceptanceCriteria: ["Report and merge candidate are available"],
        tasks: [
          {
            id: "patch",
            title: "Patch README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','sync review\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "gate",
            title: "Passing gate",
            command: `${node} -e "process.exit(0)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    const enqueueBody = enqueueResponse.json();
    const completedJobResponse = await waitForJobStatus(
      app,
      enqueueBody.job.id,
      "completed",
    );

    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${enqueueBody.workflow.id}`,
    });
    const requirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/report`,
    });
    const mergeCandidateResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/merge-candidate`,
    });

    expect(completedJobResponse.json()).toMatchObject({ status: "completed" });
    expect(workflowResponse.json()).toMatchObject({ status: "needs_review" });
    expect(requirementResponse.json()).toMatchObject({
      id: requirement.id,
      status: "needs_review",
      currentWorkflowRunId: enqueueBody.workflow.id,
      runLinks: [
        expect.objectContaining({
          workflowRunId: enqueueBody.workflow.id,
          status: "needs_review",
        }),
      ],
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toMatchObject({
      workflowId: enqueueBody.workflow.id,
      recommendation: "ready_for_review",
    });
    expect(mergeCandidateResponse.statusCode).toBe(200);
    expect(mergeCandidateResponse.json()).toMatchObject({
      workflowId: enqueueBody.workflow.id,
      status: "ready",
      patch: expect.stringContaining("+sync review"),
    });

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/workflows/${enqueueBody.workflow.id}/review`,
      payload: {
        decision: "approve",
        note: "Requirement evidence accepted",
      },
    });
    const deliveredRequirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });

    expect(reviewResponse.json()).toMatchObject({
      id: enqueueBody.workflow.id,
      status: "completed",
      review: {
        decision: "approved",
      },
    });
    expect(deliveredRequirementResponse.json()).toMatchObject({
      id: requirement.id,
      status: "delivered",
      runLinks: [
        expect.objectContaining({
          workflowRunId: enqueueBody.workflow.id,
          status: "completed",
        }),
      ],
    });
  });

  it("keeps optional failed requirement gates visible without blocking merge candidate evidence", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-optional-gate-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Review optional gate warning",
        repositoryPath: repoPath,
        goal: "Keep optional gate findings as non-blocking evidence",
        acceptanceCriteria: ["Optional lint warning remains visible"],
        tasks: [
          {
            id: "patch",
            title: "Patch README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','optional gate\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "unit",
            title: "Unit tests",
            command: `${node} -e "process.exit(0)"`,
          },
          {
            id: "optional-lint",
            title: "Optional lint",
            command: `${node} -e "console.error('optional lint warning'); process.exit(2)"`,
            required: false,
          },
          {
            id: "integration",
            title: "Integration tests",
            command: `${node} -e "process.exit(0)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    const enqueueBody = enqueueResponse.json();
    const completedJobResponse = await waitForJobStatus(
      app,
      enqueueBody.job.id,
      "completed",
    );

    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${enqueueBody.workflow.id}`,
    });
    const requirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/report`,
    });
    const mergeCandidateResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/merge-candidate`,
    });
    const workflow = workflowResponse.json();
    const report = reportResponse.json();

    expect(completedJobResponse.json()).toMatchObject({ status: "completed" });
    expect(workflow).toMatchObject({
      status: "needs_review",
      qualityGates: [
        expect.objectContaining({
          id: "unit",
          status: "passed",
          required: true,
        }),
        expect.objectContaining({
          id: "optional-lint",
          status: "failed",
          required: false,
        }),
        expect.objectContaining({
          id: "integration",
          status: "passed",
          required: true,
        }),
      ],
    });
    expect(requirementResponse.json()).toMatchObject({
      id: requirement.id,
      status: "needs_review",
      runLinks: [
        expect.objectContaining({
          workflowRunId: enqueueBody.workflow.id,
          status: "needs_review",
        }),
      ],
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(report).toMatchObject({
      workflowId: enqueueBody.workflow.id,
      recommendation: "ready_for_review",
      failedGates: [],
      gateResults: [
        expect.objectContaining({
          id: "unit",
          status: "passed",
          required: true,
        }),
        expect.objectContaining({
          id: "optional-lint",
          status: "failed",
          required: false,
          stderr: expect.stringContaining("optional lint warning"),
        }),
        expect.objectContaining({
          id: "integration",
          status: "passed",
          required: true,
        }),
      ],
    });
    expect(mergeCandidateResponse.statusCode).toBe(200);
    expect(mergeCandidateResponse.json()).toMatchObject({
      workflowId: enqueueBody.workflow.id,
      status: "ready",
      patch: expect.stringContaining("+optional gate"),
    });
  });

  it("rejects requirement enqueue when repository safety blocks execution", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-dirty-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    await writeFile(join(repoPath, "dirty.txt"), "dirty\n", "utf8");
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Dirty repo requirement",
        repositoryPath: repoPath,
        goal: "Should not start",
        acceptanceCriteria: ["Dirty repo blocks execution"],
        tasks: [
          {
            title: "Patch",
            agent: "shell",
            command: `${node} -e "process.exit(0)"`,
          },
        ],
        qualityGates: [
          {
            title: "Tests",
            command: `${node} -e "process.exit(0)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });

    expect(enqueueResponse.statusCode).toBe(409);
    expect(enqueueResponse.json()).toMatchObject({
      error: "repository_not_clean",
      safety: {
        repositoryId: requirement.id,
        dirty: true,
        blockedReason: "repository_dirty",
      },
    });
  });

  it("retries linked requirement workflows without stale evidence", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-retry-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Retry failed gate requirement",
        repositoryPath: repoPath,
        goal: "Fail first, retry cleanly",
        acceptanceCriteria: ["Retry clears stale gate result"],
        tasks: [
          {
            id: "patch",
            title: "Patch README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','retry\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "gate",
            title: "Failing gate",
            command: `${node} -e "process.exit(1)"`,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    const workflowId = enqueueResponse.json().workflow.id;
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${workflowId}/run`,
    });
    const failedRequirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });
    const failedReportResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/report`,
    });

    const retryResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/retry`,
    });
    const retryBody = retryResponse.json();
    const retryReportResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/report`,
    });
    const retryMergeCandidateResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}/merge-candidate`,
    });

    expect(runResponse.json()).toMatchObject({
      id: workflowId,
      status: "gate_failed",
      qualityGates: [
        expect.objectContaining({
          id: "gate",
          status: "failed",
        }),
      ],
    });
    expect(failedRequirementResponse.json()).toMatchObject({
      id: requirement.id,
      status: "needs_rework",
      runLinks: [
        expect.objectContaining({
          workflowRunId: workflowId,
          status: "gate_failed",
        }),
      ],
    });
    expect(failedReportResponse.statusCode).toBe(200);
    expect(failedReportResponse.json()).toMatchObject({
      workflowId,
      recommendation: "fix_failed_gates",
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryBody).toMatchObject({
      requirement: {
        id: requirement.id,
        status: "ready_to_run",
        currentWorkflowRunId: workflowId,
        runLinks: [
          expect.objectContaining({
            workflowRunId: workflowId,
            status: "ready",
          }),
        ],
      },
      workflow: {
        id: workflowId,
        status: "ready",
        qualityGates: [
          expect.objectContaining({
            id: "gate",
            status: "waiting",
          }),
        ],
      },
      retry: {
        previousStatus: "gate_failed",
        status: "ready",
      },
    });
    expect(retryBody.workflow.qualityGates[0].result).toBeUndefined();
    expect(retryReportResponse.statusCode).toBe(409);
    expect(retryReportResponse.json()).toMatchObject({
      error: "requirement_report_not_ready",
      workflowRunId: workflowId,
      status: "ready_to_run",
    });
    expect(retryMergeCandidateResponse.statusCode).toBe(409);
    expect(retryMergeCandidateResponse.json()).toMatchObject({
      error: "requirement_merge_candidate_not_ready",
      workflowRunId: workflowId,
    });
  });

  it("lists configured agents without exposing command templates", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_CODEX_COMMAND_TEMPLATE: "codex run --prompt-file {promptFile}",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/agents",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: "fake-agent", label: "Fake CLI Agent" },
      { id: "codex", label: "Codex CLI" },
    ]);
  });

  it("exposes agent health without exposing command templates", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_CODEX_COMMAND_TEMPLATE:
          "missing-codex-binary run --prompt-file {promptFile}",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/agents/health",
    });
    const health = response.json();

    expect(response.statusCode).toBe(200);
    expect(health).toEqual([
      expect.objectContaining({
        id: "fake-agent",
        healthy: true,
        status: "healthy",
      }),
      expect.objectContaining({
        id: "codex",
        healthy: false,
        status: "missing_command",
        command: "missing-codex-binary",
      }),
    ]);
    expect(JSON.stringify(health)).not.toContain("{promptFile}");
  });

  it("exposes worker health from heartbeat audit events", async () => {
    const freshSeenAt = new Date(Date.now() - 5_000).toISOString();
    const staleSeenAt = new Date(Date.now() - 120_000).toISOString();
    const auditEvents: AuditEvent[] = [
      {
        id: "audit-worker-a-old",
        type: "worker.heartbeat" as AuditEvent["type"],
        createdAt: staleSeenAt,
        actor: "worker",
        metadata: {
          workerId: "worker-a",
          status: "idle",
        },
      },
      {
        id: "audit-worker-a-new",
        type: "worker.heartbeat" as AuditEvent["type"],
        createdAt: freshSeenAt,
        actor: "worker",
        workflowId: "workflow-1",
        jobId: "job-1",
        metadata: {
          workerId: "worker-a",
          status: "running",
        },
      },
      {
        id: "audit-worker-b-stale",
        type: "worker.heartbeat" as AuditEvent["type"],
        createdAt: staleSeenAt,
        actor: "worker",
        metadata: {
          workerId: "worker-b",
          status: "idle",
        },
      },
    ];
    const auditStore: AuditStore = {
      list: vi.fn(async (filter) =>
        auditEvents.filter((event) =>
          filter?.type ? event.type === filter.type : true,
        ),
      ),
      append: vi.fn(),
    };
    const app = buildApp(undefined, {
      auditStore,
      env: {
        MAWO_WORKER_STALE_MS: "60000",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/workers/health",
    });
    const health = response.json();

    expect(response.statusCode).toBe(200);
    expect(health).toMatchObject({
      ok: true,
      staleAfterMs: 60_000,
      summary: {
        totalWorkers: 2,
        healthyWorkers: 1,
        staleWorkers: 1,
      },
      workers: [
        {
          workerId: "worker-a",
          healthy: true,
          status: "running",
          lastSeenAt: freshSeenAt,
          workflowId: "workflow-1",
          jobId: "job-1",
        },
        {
          workerId: "worker-b",
          healthy: false,
          status: "idle",
          lastSeenAt: staleSeenAt,
        },
      ],
    });
  });

  it("reports deployment readiness without exposing agent command templates", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-readiness-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_API_TOKEN: "secret-token",
        MAWO_CODEX_COMMAND_TEMPLATE:
          "missing-codex-binary run --prompt-file {promptFile}",
      },
    });

    const rejectedResponse = await app.inject({
      method: "GET",
      url: "/readiness",
    });
    const response = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: {
        authorization: "Bearer secret-token",
      },
    });
    const readiness = response.json();

    expect(rejectedResponse.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(readiness).toMatchObject({
      ok: false,
      service: "mawo-api",
      protectedByToken: true,
      activeJobs: 0,
    });
    expect(readiness.checkedAt).toEqual(expect.any(String));
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "state_store",
          ok: true,
          status: "ready",
          path: join(demoRoot, ".mawo", "state"),
        }),
        expect.objectContaining({
          id: "artifact_store",
          ok: true,
          status: "ready",
          path: join(demoRoot, ".mawo", "artifacts"),
        }),
        expect.objectContaining({
          id: "git_cli",
          ok: true,
          status: "ready",
        }),
        expect.objectContaining({
          id: "agents",
          ok: false,
          status: "degraded",
          healthyAgents: 1,
          totalAgents: 2,
        }),
      ]),
    );
    expect(JSON.stringify(readiness)).not.toContain("{promptFile}");
  });

  it("blocks production readiness when postgres queue has no fresh worker heartbeat", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-postgres-worker-blocked-test-"),
    );
    tempRoots.push(demoRoot);
    const token = "production-token-1234567890";
    const { prismaClient } = createMutablePrismaStateClient();
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        NODE_ENV: "production",
        MAWO_API_TOKEN: token,
        MAWO_ALLOWED_REPOSITORY_ROOTS: demoRoot,
        MAWO_STATE_BACKEND: "postgres",
        MAWO_QUEUE_BACKEND: "postgres",
        DATABASE_URL: "postgresql://mawo:secret@localhost:5432/mawo",
        MAWO_WORKER_STALE_MS: "60000",
      },
      prismaClient,
    });

    const response = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const readiness = response.json();

    expect(response.statusCode).toBe(200);
    expect(readiness).toMatchObject({
      ok: false,
      deploymentMode: "production",
    });
    expect(readiness.checks).toContainEqual(
      expect.objectContaining({
        id: "workers",
        ok: false,
        status: "blocked",
        required: true,
        healthyWorkers: 0,
        totalWorkers: 0,
      }),
    );
  });

  it("blocks production readiness when security deployment settings are placeholders", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-production-readiness-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        NODE_ENV: "production",
        MAWO_API_TOKEN: "change-me-before-production",
        MAWO_ALLOWED_REPOSITORY_ROOTS: "",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: {
        authorization: "Bearer change-me-before-production",
      },
    });
    const readiness = response.json();

    expect(response.statusCode).toBe(200);
    expect(readiness).toMatchObject({
      ok: false,
      deploymentMode: "production",
      protectedByToken: true,
    });
    expect(readiness.checks).toContainEqual(
      expect.objectContaining({
        id: "production_config",
        ok: false,
        status: "blocked",
        missing: expect.arrayContaining([
          "MAWO_API_TOKEN",
          "MAWO_ALLOWED_REPOSITORY_ROOTS",
        ]),
      }),
    );
    expect(JSON.stringify(readiness)).not.toContain(
      "change-me-before-production",
    );
  });

  it("blocks production readiness when file-backed runtime is scaled past one API replica", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-production-topology-test-"),
    );
    tempRoots.push(demoRoot);
    const token = "production-token-1234567890";
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        NODE_ENV: "production",
        MAWO_API_TOKEN: token,
        MAWO_ALLOWED_REPOSITORY_ROOTS: demoRoot,
        MAWO_API_REPLICA_COUNT: "2",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const readiness = response.json();

    expect(response.statusCode).toBe(200);
    expect(readiness).toMatchObject({
      ok: false,
      deploymentMode: "production",
    });
    expect(readiness.checks).toContainEqual(
      expect.objectContaining({
        id: "deployment_topology",
        ok: false,
        status: "blocked",
        apiReplicaCount: 2,
        stateBackend: "file",
        queueBackend: "in_process",
      }),
    );
  });

  it("blocks production readiness when an unsupported queue backend is requested", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-production-backend-test-"),
    );
    tempRoots.push(demoRoot);
    const token = "production-token-1234567890";
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        NODE_ENV: "production",
        MAWO_API_TOKEN: token,
        MAWO_ALLOWED_REPOSITORY_ROOTS: demoRoot,
        MAWO_STATE_BACKEND: "postgres",
        MAWO_QUEUE_BACKEND: "redis",
        DATABASE_URL: "postgresql://mawo:secret@localhost:5432/mawo",
        REDIS_URL: "redis://localhost:6379",
      },
      prismaClient: createEmptyPrismaStateClient(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const readiness = response.json();

    expect(response.statusCode).toBe(200);
    expect(readiness).toMatchObject({
      ok: false,
      deploymentMode: "production",
    });
    expect(readiness.checks).toContainEqual(
      expect.objectContaining({
        id: "runtime_backend",
        ok: false,
        status: "blocked",
        requestedStateBackend: "postgres",
        activeStateBackend: "postgres",
        requestedQueueBackend: "redis",
        activeQueueBackend: "in_process",
        databaseUrlConfigured: true,
        redisUrlConfigured: true,
      }),
    );
  });

  it("allows production readiness to scale when postgres state and queue backends are active", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-postgres-queue-ready-test-"),
    );
    tempRoots.push(demoRoot);
    const token = "production-token-1234567890";
    const { auditEvents, prismaClient } = createMutablePrismaStateClient();
    auditEvents.push({
      id: "audit-worker-ready",
      type: "worker.heartbeat",
      actor: "worker",
      workflowRunId: null,
      jobId: null,
      metadata: {
        workerId: "worker-a",
        status: "idle",
      },
      createdAt: new Date(),
    });
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        NODE_ENV: "production",
        MAWO_API_TOKEN: token,
        MAWO_ALLOWED_REPOSITORY_ROOTS: demoRoot,
        MAWO_STATE_BACKEND: "postgres",
        MAWO_QUEUE_BACKEND: "postgres",
        MAWO_API_REPLICA_COUNT: "2",
        DATABASE_URL: "postgresql://mawo:secret@localhost:5432/mawo",
      },
      prismaClient,
    });

    const response = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const readiness = response.json();
    const runtimeBackend = readiness.checks.find(
      (check: { id: string }) => check.id === "runtime_backend",
    );
    const deploymentTopology = readiness.checks.find(
      (check: { id: string }) => check.id === "deployment_topology",
    );
    const workerHealth = readiness.checks.find(
      (check: { id: string }) => check.id === "workers",
    );

    expect(response.statusCode).toBe(200);
    expect(readiness).toMatchObject({
      ok: true,
      deploymentMode: "production",
    });
    expect(runtimeBackend).toMatchObject({
      ok: true,
      status: "ready",
      requestedStateBackend: "postgres",
      activeStateBackend: "postgres",
      requestedQueueBackend: "postgres",
      activeQueueBackend: "postgres",
      databaseUrlConfigured: true,
    });
    expect(deploymentTopology).toMatchObject({
      ok: true,
      status: "ready",
      apiReplicaCount: 2,
      stateBackend: "postgres",
      queueBackend: "postgres",
    });
    expect(workerHealth).toMatchObject({
      ok: true,
      status: "ready",
      required: true,
      healthyWorkers: 1,
      totalWorkers: 1,
    });
    expect(deploymentTopology.maxSupportedApiReplicas).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("returns an operations snapshot with scoped jobs audit readiness and worker health", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-operations-snapshot-test-"),
    );
    tempRoots.push(demoRoot);
    const now = new Date().toISOString();
    const auditEvents: AuditEvent[] = [
      {
        id: "audit-1",
        type: "workflow.enqueued",
        createdAt: now,
        actor: "operator",
        workflowId: "workflow-1",
        jobId: "job-1",
        metadata: {
          repositoryId: "repo-1",
        },
      },
      {
        id: "audit-2",
        type: "workflow.enqueued",
        createdAt: now,
        actor: "operator",
        workflowId: "workflow-2",
        metadata: {
          repositoryId: "repo-2",
        },
      },
      {
        id: "audit-worker",
        type: "worker.heartbeat",
        createdAt: now,
        actor: "worker",
        workflowId: "workflow-1",
        jobId: "job-1",
        metadata: {
          workerId: "worker-a",
          status: "running",
        },
      },
    ];
    const auditStore: AuditStore = {
      list: vi.fn(async (filter) =>
        auditEvents.filter((event) => {
          if (filter?.type && event.type !== filter.type) {
            return false;
          }
          if (
            filter?.repositoryId &&
            event.metadata?.repositoryId !== filter.repositoryId
          ) {
            return false;
          }
          return true;
        }),
      ),
      append: vi.fn(),
    };
    const jobs: WorkflowJob[] = [
      {
        id: "job-1",
        workflowId: "workflow-1",
        status: "queued",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "job-2",
        workflowId: "workflow-2",
        status: "failed",
        createdAt: now,
        updatedAt: now,
      },
    ];
    const jobStore: JobStore = {
      list: vi.fn(() => jobs),
      save: vi.fn(),
    };
    const storedWorkflows: LocalWorkflowRun[] = [
      {
        id: "workflow-1",
        goal: "Review repo one",
        status: "needs_review",
        executionMode: "direct",
        repositoryId: "repo-1",
        createdAt: now,
        updatedAt: now,
        tasks: [],
        qualityGates: [],
      },
      {
        id: "workflow-2",
        goal: "Review repo two",
        status: "needs_review",
        executionMode: "direct",
        repositoryId: "repo-2",
        createdAt: now,
        updatedAt: now,
        tasks: [],
        qualityGates: [],
      },
    ];
    const runner = new LocalRunner(undefined, {
      runStore: {
        list: vi.fn(async () => storedWorkflows),
        save: vi.fn(),
      },
    });
    const app = buildApp(runner, {
      demoRoot,
      auditStore,
      jobStore,
      env: {
        MAWO_WORKER_STALE_MS: "60000",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/operations/snapshot?repositoryId=repo-1&limit=1",
    });
    const snapshot = response.json();

    expect(response.statusCode).toBe(200);
    expect(snapshot).toMatchObject({
      repositoryId: "repo-1",
      summary: {
        queuedJobs: 1,
        runningJobs: 0,
        activeJobs: 1,
        failedJobs: 0,
        needsReviewWorkflows: 1,
        healthyWorkers: 1,
        totalWorkers: 1,
      },
    });
    expect(snapshot.auditEvents).toHaveLength(1);
    expect(snapshot.auditEvents[0]).toMatchObject({
      id: "audit-1",
      workflowId: "workflow-1",
    });
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({
      id: "job-1",
      workflowId: "workflow-1",
    });
    expect(snapshot.readiness.activeJobs).toBe(1);
    expect(snapshot.workerHealth.summary.healthyWorkers).toBe(1);
  });

  it("refreshes persisted workflow state before building operations snapshots", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-operations-refresh-test-"),
    );
    tempRoots.push(demoRoot);
    const now = new Date().toISOString();
    let storedWorkflows: LocalWorkflowRun[] = [
      {
        id: "workflow-refresh",
        goal: "Refresh before snapshot",
        status: "ready",
        executionMode: "direct",
        repositoryId: "repo-refresh",
        createdAt: now,
        updatedAt: now,
        tasks: [],
        qualityGates: [],
      },
    ];
    const runner = new LocalRunner(undefined, {
      runStore: {
        list: vi.fn(async () => storedWorkflows),
        save: vi.fn(),
      },
    });
    const app = buildApp(runner, {
      demoRoot,
      env: {
        MAWO_WORKER_STALE_MS: "60000",
      },
    });

    await app.ready();
    expect(runner.getWorkflow("workflow-refresh")?.status).toBe("ready");

    storedWorkflows = [
      {
        ...storedWorkflows[0]!,
        status: "needs_review",
        updatedAt: new Date().toISOString(),
      },
    ];
    const response = await app.inject({
      method: "GET",
      url: "/operations/snapshot?repositoryId=repo-refresh",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().summary.needsReviewWorkflows).toBe(1);
  });

  it("refreshes persisted workflow state before review decisions", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-review-refresh-test-"));
    tempRoots.push(demoRoot);
    const now = new Date().toISOString();
    let storedWorkflows: LocalWorkflowRun[] = [
      {
        id: "workflow-review-refresh",
        goal: "Review after external worker",
        status: "ready",
        executionMode: "direct",
        repositoryId: "repo-review-refresh",
        createdAt: now,
        updatedAt: now,
        tasks: [],
        qualityGates: [],
      },
    ];
    const runner = new LocalRunner(undefined, {
      runStore: {
        list: vi.fn(async () => storedWorkflows),
        save: vi.fn((run: LocalWorkflowRun) => {
          storedWorkflows = [run];
        }),
      },
    });
    const app = buildApp(runner, { demoRoot });

    await app.ready();
    storedWorkflows = [
      {
        ...storedWorkflows[0]!,
        status: "needs_review",
        updatedAt: new Date().toISOString(),
      },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/workflows/workflow-review-refresh/review",
      payload: {
        decision: "approve",
        note: "External worker finished",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "workflow-review-refresh",
      status: "completed",
      review: {
        decision: "approved",
        note: "External worker finished",
      },
    });
  });

  it("creates, runs, and reports a demo workflow", async () => {
    const app = buildApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.status).toBe("ready");
    expect(created.tasks).toHaveLength(3);

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");

    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const report = reportResponse.json();

    expect(reportResponse.statusCode).toBe(200);
    expect(report.recommendation).toBe("ready_for_review");
    expect(report.summary).toContain("3/3 tasks passed");
  });

  it("creates a worktree demo workflow that returns patch artifacts", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-server-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.executionMode).toBe("worktree");
    expect(created.repositoryPath).toContain("demo-repo");

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0].workspace.path).toContain("worktrees");
    expect(completed.tasks[0].diff.patch).toContain("+worktree runner");

    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const report = reportResponse.json();

    expect(report.taskResults[0].patch).toContain("+worktree runner");
  });

  it("creates a CLI agent demo workflow that returns agent metadata and patch artifacts", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-agent-server-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/agent-demo",
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.tasks[0].agent).toBe("fake-agent");

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0].result.metadata.agentId).toBe("fake-agent");
    expect(completed.tasks[0].diff.patch).toContain("+cli agent adapter");

    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const report = reportResponse.json();

    expect(report.taskResults[0].agentId).toBe("fake-agent");
    expect(report.taskResults[0].patch).toContain("+cli agent adapter");
  });

  it("restores workflow state and report artifacts when the API is rebuilt", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-persist-test-"));
    tempRoots.push(demoRoot);
    const firstApp = buildApp(undefined, { demoRoot });

    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });

    const secondApp = buildApp(undefined, { demoRoot });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: `/workflows/${created.id}`,
    });
    const reportResponse = await secondApp.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const restored = restoredResponse.json();
    const report = reportResponse.json();

    expect(restoredResponse.statusCode).toBe(200);
    expect(restored.status).toBe("needs_review");
    expect(report.reportArtifactPath).toContain("report.json");
    expect(report.taskResults[0].patchArtifactPath).toContain("patch.diff");
    expect(report.taskResults[0].patch).toContain("+worktree runner");
  });

  it("filters workflow history by status and repository path before limiting", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-workflow-filter-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const firstRepositoryWorkflowResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "First repository workflow",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "noop",
            agent: "shell",
            command: `${node} -e "console.log('first')"`,
          },
        ],
        qualityGates: [],
      },
    });
    const secondRepositoryWorkflowResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Second repository workflow",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "noop",
            agent: "shell",
            command: `${node} -e "console.log('second')"`,
          },
        ],
        qualityGates: [],
      },
    });
    const firstRepositoryWorkflow = firstRepositoryWorkflowResponse.json();
    const secondRepositoryWorkflow = secondRepositoryWorkflowResponse.json();

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/workflows?status=ready&repositoryPath=${encodeURIComponent(
        repoPath,
      )}&limit=1`,
    });
    const invalidStatusResponse = await app.inject({
      method: "GET",
      url: "/workflows?status=not-real",
    });

    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json()).toEqual([
      expect.objectContaining({
        id: secondRepositoryWorkflow.id,
        status: "ready",
        repositoryPath: repoPath,
      }),
    ]);
    expect(filteredResponse.json()).not.toEqual([
      expect.objectContaining({
        id: firstRepositoryWorkflow.id,
      }),
    ]);
    expect(invalidStatusResponse.statusCode).toBe(400);
    expect(invalidStatusResponse.json()).toMatchObject({
      error: "invalid_workflow_status",
    });
  });

  it("serves persisted workflow artifacts through a bounded API endpoint", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-artifact-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const report = reportResponse.json();

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?path=${encodeURIComponent(
        report.reportArtifactPath,
      )}`,
    });
    const artifact = artifactResponse.json();

    expect(artifactResponse.statusCode).toBe(200);
    expect(artifact).toMatchObject({
      workflowId: created.id,
      contentType: "text/plain; charset=utf-8",
      truncated: false,
    });
    expect(artifact.path).toContain("report.json");
    expect(artifact.sizeBytes).toBeGreaterThan(0);
    expect(artifact.content).toContain('"recommendation": "ready_for_review"');
  });

  it("records audit events when workflow artifacts are read", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-artifact-audit-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const report = reportResponse.json();

    await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?maxBytes=128&path=${encodeURIComponent(
        report.reportArtifactPath,
      )}`,
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?workflowId=${created.id}`,
    });
    const artifactRead = auditResponse
      .json()
      .find(
        (event: { type: string }) => event.type === "workflow.artifact_read",
      );

    expect(auditResponse.statusCode).toBe(200);
    expect(artifactRead).toMatchObject({
      type: "workflow.artifact_read",
      actor: "operator",
      workflowId: created.id,
      metadata: {
        artifactPath: report.reportArtifactPath,
        maxBytes: "128",
        truncated: "true",
      },
    });
    expect(Number(artifactRead.metadata.sizeBytes)).toBeGreaterThan(128);
  });

  it("rejects artifact reads outside the workflow artifact directory", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-artifact-guard-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?path=${encodeURIComponent(
        join(demoRoot, ".mawo", "state", "workflows.json"),
      )}`,
    });

    expect(artifactResponse.statusCode).toBe(403);
    expect(artifactResponse.json()).toMatchObject({
      error: "artifact_path_not_allowed",
    });
  });

  it("returns only the requested artifact prefix for large files", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-artifact-limit-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`,
    });
    const report = reportResponse.json();
    await writeFile(report.reportArtifactPath, "🙂🙂🙂", "utf8");

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?maxBytes=8&path=${encodeURIComponent(
        report.reportArtifactPath,
      )}`,
    });
    const artifact = artifactResponse.json();

    expect(artifactResponse.statusCode).toBe(200);
    expect(artifact.truncated).toBe(true);
    expect(artifact.maxBytes).toBe(8);
    expect(artifact.sizeBytes).toBe(12);
    expect(Buffer.byteLength(artifact.content, "utf8")).toBeLessThanOrEqual(8);
  });

  it("persists audit events for operator workflow actions across API rebuilds", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-audit-test-"));
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const firstApp = buildApp(undefined, { demoRoot });

    const demoCreateResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const demoWorkflow = demoCreateResponse.json();
    const enqueueResponse = await firstApp.inject({
      method: "POST",
      url: `/workflows/${demoWorkflow.id}/enqueue`,
    });
    const queuedJob = enqueueResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/jobs/${queuedJob.id}/cancel`,
    });

    const reviewCreateResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const reviewWorkflow = reviewCreateResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${reviewWorkflow.id}/run`,
    });
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${reviewWorkflow.id}/review`,
      payload: {
        decision: "approve",
        note: "Audit trail ready",
      },
    });

    const failCreateResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Audit retry workflow",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "fail",
            title: "Fail once",
            agent: "shell",
            command: `${node} -e "process.exit(7)"`,
          },
        ],
        qualityGates: [],
      },
    });
    const retryWorkflow = failCreateResponse.json();
    const failedRetryRunResponse = await firstApp.inject({
      method: "POST",
      url: `/workflows/${retryWorkflow.id}/run`,
    });
    const failedRetryRun = failedRetryRunResponse.json() as {
      tasks: Array<{ workspace?: { path: string; branch: string } }>;
    };
    const retryWorkspace = failedRetryRun.tasks[0]?.workspace;
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${retryWorkflow.id}/retry`,
    });

    const auditResponse = await firstApp.inject({
      method: "GET",
      url: "/audit-events",
    });
    const events = auditResponse.json();

    expect(auditResponse.statusCode).toBe(200);
    expect(events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.created",
        "workflow.enqueued",
        "job.canceled",
        "workflow.reviewed",
        "workflow.retry_requested",
      ]),
    );
    expect(
      events.find(
        (event: { type: string; workflowId?: string; jobId?: string }) =>
          event.type === "job.canceled" && event.jobId === queuedJob.id,
      ),
    ).toMatchObject({
      workflowId: demoWorkflow.id,
      jobId: queuedJob.id,
    });
    expect(retryWorkspace).toBeDefined();
    expect(
      events.find(
        (event: { type: string; workflowId?: string }) =>
          event.type === "workflow.retry_requested" &&
          event.workflowId === retryWorkflow.id,
      ),
    ).toMatchObject({
      metadata: {
        previousStatus: "failed",
        status: "ready",
        cleanedCount: "1",
        cleanedTaskIds: "fail",
        cleanedBranches: retryWorkspace?.branch,
        cleanedPaths: retryWorkspace?.path,
      },
    });

    const secondApp = buildApp(undefined, { demoRoot });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: "/audit-events",
    });
    const restoredEvents = restoredResponse.json();

    expect(restoredResponse.statusCode).toBe(200);
    expect(restoredEvents.map((event: { id: string }) => event.id)).toEqual(
      events.map((event: { id: string }) => event.id),
    );
  });

  it("persists task and gate lifecycle audit events while workflows run", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-runtime-audit-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?workflowId=${created.id}`,
    });
    const events = auditResponse.json();

    expect(auditResponse.statusCode).toBe(200);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow.task_started",
          workflowId: created.id,
          metadata: expect.objectContaining({
            taskId: "plan",
          }),
        }),
        expect.objectContaining({
          type: "workflow.task_completed",
          workflowId: created.id,
          metadata: expect.objectContaining({
            taskId: "plan",
            status: "passed",
          }),
        }),
        expect.objectContaining({
          type: "workflow.gate_started",
          workflowId: created.id,
          metadata: expect.objectContaining({
            gateId: "node",
          }),
        }),
        expect.objectContaining({
          type: "workflow.gate_completed",
          workflowId: created.id,
          metadata: expect.objectContaining({
            gateId: "node",
            status: "passed",
          }),
        }),
      ]),
    );
  });

  it("limits audit event history to the most recent events", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-audit-limit-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    await app.inject({ method: "POST", url: "/workflows/demo" });
    await app.inject({ method: "POST", url: "/workflows/worktree-demo" });
    await app.inject({ method: "POST", url: "/workflows/agent-demo" });

    const allResponse = await app.inject({
      method: "GET",
      url: "/audit-events",
    });
    const limitedResponse = await app.inject({
      method: "GET",
      url: "/audit-events?limit=2",
    });
    const events = allResponse.json();
    const limited = limitedResponse.json();

    expect(limitedResponse.statusCode).toBe(200);
    expect(limited.map((event: { id: string }) => event.id)).toEqual(
      events.slice(-2).map((event: { id: string }) => event.id),
    );
  });

  it("filters audit events by type actor job and repository metadata", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-audit-filter-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const repositoryResponse = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Filter repo",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [],
      },
    });
    const repository = repositoryResponse.json();
    await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Filter repo updated",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [],
      },
    });
    const workflowResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const workflow = workflowResponse.json();
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${workflow.id}/enqueue`,
    });
    const job = enqueueResponse.json();
    await app.inject({
      method: "POST",
      url: `/jobs/${job.id}/cancel`,
    });

    const repositoryAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=repository.updated&actor=operator&repositoryId=${repository.id}&limit=1`,
    });
    const jobAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=job.canceled&jobId=${job.id}&actor=operator`,
    });
    const invalidTypeResponse = await app.inject({
      method: "GET",
      url: "/audit-events?type=not.real",
    });

    expect(repositoryAuditResponse.statusCode).toBe(200);
    expect(repositoryAuditResponse.json()).toEqual([
      expect.objectContaining({
        type: "repository.updated",
        actor: "operator",
        metadata: expect.objectContaining({
          repositoryId: repository.id,
          repositoryName: "Filter repo updated",
        }),
      }),
    ]);
    expect(jobAuditResponse.statusCode).toBe(200);
    expect(jobAuditResponse.json()).toEqual([
      expect.objectContaining({
        type: "job.canceled",
        jobId: job.id,
        actor: "operator",
      }),
    ]);
    expect(invalidTypeResponse.statusCode).toBe(400);
    expect(invalidTypeResponse.json()).toMatchObject({
      error: "invalid_audit_event_type",
    });
  });

  it("restores completed job history when the API is rebuilt", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-job-persist-test-"),
    );
    tempRoots.push(demoRoot);
    const firstApp = buildApp(undefined, { demoRoot });
    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    const enqueueResponse = await firstApp.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`,
    });
    const queued = enqueueResponse.json();
    let job = queued;
    for (
      let attempt = 0;
      attempt < 20 && job.status !== "completed";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const jobResponse = await firstApp.inject({
        method: "GET",
        url: `/jobs/${queued.id}`,
      });
      job = jobResponse.json();
    }

    const secondApp = buildApp(undefined, { demoRoot });
    const jobsResponse = await secondApp.inject({
      method: "GET",
      url: "/jobs",
    });
    const restoredJobs = jobsResponse.json();

    expect(job.status).toBe("completed");
    expect(jobsResponse.statusCode).toBe(200);
    expect(restoredJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: queued.id,
          workflowId: created.id,
          status: "completed",
        }),
      ]),
    );
  });

  it("returns a job timeline with workflow summary and lifecycle events", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-job-timeline-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`,
    });
    const queued = enqueueResponse.json();
    let job = queued;
    for (
      let attempt = 0;
      attempt < 20 && job.status !== "completed";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const jobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${queued.id}`,
      });
      job = jobResponse.json();
    }

    const timelineResponse = await app.inject({
      method: "GET",
      url: `/jobs/${queued.id}/timeline`,
    });
    const timeline = timelineResponse.json();

    expect(job.status).toBe("completed");
    expect(timelineResponse.statusCode).toBe(200);
    expect(timeline.job).toMatchObject({
      id: queued.id,
      workflowId: created.id,
      status: "completed",
    });
    expect(timeline.workflow).toMatchObject({
      id: created.id,
      status: "needs_review",
    });
    expect(timeline.summary).toMatchObject({
      recommendation: "ready_for_review",
      failedTasks: [],
      failedGates: [],
    });
    expect(
      timeline.events.map((event: { type: string }) => event.type),
    ).toEqual(
      expect.arrayContaining([
        "workflow.enqueued",
        "workflow.task_started",
        "workflow.task_completed",
        "workflow.gate_started",
        "workflow.gate_completed",
      ]),
    );
    expect(timeline.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow.task_completed",
          metadata: expect.objectContaining({
            taskId: "plan",
            status: "passed",
          }),
        }),
      ]),
    );
  });

  it("limits job history to the most recent jobs", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-job-limit-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const first = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();
    const second = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();
    const third = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();

    await app.inject({ method: "POST", url: `/workflows/${first.id}/enqueue` });
    await app.inject({
      method: "POST",
      url: `/workflows/${second.id}/enqueue`,
    });
    await app.inject({ method: "POST", url: `/workflows/${third.id}/enqueue` });

    const allResponse = await app.inject({ method: "GET", url: "/jobs" });
    const limitedResponse = await app.inject({
      method: "GET",
      url: "/jobs?limit=2",
    });
    const jobs = allResponse.json();
    const limited = limitedResponse.json();

    expect(limitedResponse.statusCode).toBe(200);
    expect(limited.map((job: { id: string }) => job.id)).toEqual(
      jobs.slice(-2).map((job: { id: string }) => job.id),
    );
  });

  it("filters job history by status and workflow before applying limits", async () => {
    vi.useFakeTimers();
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-job-filter-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const first = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();
    const second = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();
    const third = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();

    const firstJob = (
      await app.inject({
        method: "POST",
        url: `/workflows/${first.id}/enqueue`,
      })
    ).json();
    await app.inject({ method: "POST", url: `/jobs/${firstJob.id}/cancel` });
    const secondJob = (
      await app.inject({
        method: "POST",
        url: `/workflows/${second.id}/enqueue`,
      })
    ).json();
    await app.inject({ method: "POST", url: `/jobs/${secondJob.id}/cancel` });
    const thirdJob = (
      await app.inject({
        method: "POST",
        url: `/workflows/${third.id}/enqueue`,
      })
    ).json();

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/jobs?status=canceled&workflowId=${second.id}&limit=1`,
    });
    const filtered = filteredResponse.json();

    expect(filteredResponse.statusCode).toBe(200);
    expect(filtered).toEqual([
      expect.objectContaining({
        id: secondJob.id,
        workflowId: second.id,
        status: "canceled",
      }),
    ]);
    expect(filtered).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstJob.id }),
        expect.objectContaining({ id: thirdJob.id }),
      ]),
    );
  });

  it("filters job history and job audit events by registered repository id", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-job-repository-filter-test-"),
    );
    const firstRepoPath = await createCommittedRepo();
    const secondRepoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const firstRepository = (
      await app.inject({
        method: "POST",
        url: "/repositories",
        payload: {
          name: "First job repo",
          path: firstRepoPath,
          qualityGates: [],
        },
      })
    ).json();
    const secondRepository = (
      await app.inject({
        method: "POST",
        url: "/repositories",
        payload: {
          name: "Second job repo",
          path: secondRepoPath,
          qualityGates: [],
        },
      })
    ).json();
    const firstWorkflow = (
      await app.inject({
        method: "POST",
        url: "/workflows/repository",
        payload: {
          goal: "Queue first repository workflow",
          repositoryId: firstRepository.id,
          tasks: [
            {
              id: "first-task",
              agent: "shell",
              command: `${node} -e "console.log('first')"`,
            },
          ],
        },
      })
    ).json();
    const secondWorkflow = (
      await app.inject({
        method: "POST",
        url: "/workflows/repository",
        payload: {
          goal: "Queue second repository workflow",
          repositoryId: secondRepository.id,
          tasks: [
            {
              id: "second-task",
              agent: "shell",
              command: `${node} -e "console.log('second')"`,
            },
          ],
        },
      })
    ).json();

    vi.useFakeTimers();
    const firstJob = (
      await app.inject({
        method: "POST",
        url: `/workflows/${firstWorkflow.id}/enqueue`,
      })
    ).json();
    await app.inject({ method: "POST", url: `/jobs/${firstJob.id}/cancel` });
    const secondJob = (
      await app.inject({
        method: "POST",
        url: `/workflows/${secondWorkflow.id}/enqueue`,
      })
    ).json();
    await app.inject({ method: "POST", url: `/jobs/${secondJob.id}/cancel` });

    const repositoryJobsResponse = await app.inject({
      method: "GET",
      url: `/jobs?status=canceled&repositoryId=${firstRepository.id}&limit=1`,
    });
    const enqueuedAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=workflow.enqueued&repositoryId=${firstRepository.id}`,
    });
    const canceledAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=job.canceled&repositoryId=${firstRepository.id}`,
    });

    expect(repositoryJobsResponse.statusCode).toBe(200);
    expect(repositoryJobsResponse.json()).toEqual([
      expect.objectContaining({
        id: firstJob.id,
        workflowId: firstWorkflow.id,
        status: "canceled",
      }),
    ]);
    expect(repositoryJobsResponse.json()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondJob.id })]),
    );
    expect(enqueuedAuditResponse.statusCode).toBe(200);
    expect(enqueuedAuditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "workflow.enqueued",
        workflowId: firstWorkflow.id,
        jobId: firstJob.id,
        metadata: expect.objectContaining({
          repositoryId: firstRepository.id,
          repositoryPath: firstRepoPath,
        }),
      }),
    );
    expect(canceledAuditResponse.statusCode).toBe(200);
    expect(canceledAuditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "job.canceled",
        workflowId: firstWorkflow.id,
        jobId: firstJob.id,
        metadata: expect.objectContaining({
          repositoryId: firstRepository.id,
          repositoryPath: firstRepoPath,
        }),
      }),
    );
  });

  it("rejects invalid job history statuses", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/jobs?status=not-real",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_job_status",
      allowedStatuses: ["queued", "running", "completed", "failed", "canceled"],
    });
  });

  it("records audit events for jobs recovered after API restart", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-job-recovery-audit-test-"),
    );
    const stateRoot = join(demoRoot, ".mawo", "state");
    tempRoots.push(demoRoot);
    await mkdir(stateRoot, { recursive: true });
    await writeFile(
      join(stateRoot, "jobs.json"),
      JSON.stringify(
        [
          {
            id: "running-job",
            workflowId: "workflow-2",
            status: "running",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:01.000Z",
            startedAt: "2026-06-05T00:00:01.000Z",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const app = buildApp(undefined, { demoRoot });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events",
    });

    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "job.recovered",
        actor: "system",
        workflowId: "workflow-2",
        jobId: "running-job",
        metadata: expect.objectContaining({
          previousStatus: "running",
          recoveredStatus: "failed",
        }),
      }),
    );
  });

  it("recovers interrupted workflow state when active jobs are recovered after API restart", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-workflow-recovery-test-"),
    );
    const stateRoot = join(demoRoot, ".mawo", "state");
    tempRoots.push(demoRoot);
    await mkdir(stateRoot, { recursive: true });
    await writeFile(
      join(stateRoot, "jobs.json"),
      JSON.stringify(
        [
          {
            id: "running-job",
            workflowId: "workflow-restart",
            status: "running",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:01.000Z",
            startedAt: "2026-06-05T00:00:01.000Z",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      join(stateRoot, "workflows.json"),
      JSON.stringify(
        [
          {
            id: "workflow-restart",
            goal: "Recover interrupted workflow",
            status: "running",
            executionMode: "direct",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:01.000Z",
            tasks: [
              {
                id: "running-task",
                title: "Running task",
                agent: "shell",
                command: `${node} -e "console.log('task')"`,
                status: "running",
              },
              {
                id: "waiting-task",
                title: "Waiting task",
                agent: "shell",
                command: `${node} -e "console.log('waiting')"`,
                status: "waiting",
              },
            ],
            qualityGates: [
              {
                id: "running-gate",
                title: "Running gate",
                command: `${node} -e "console.log('gate')"`,
                status: "running",
              },
            ],
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const app = buildApp(undefined, { demoRoot });
    const workflowResponse = await app.inject({
      method: "GET",
      url: "/workflows/workflow-restart",
    });
    const jobResponse = await app.inject({
      method: "GET",
      url: "/jobs/running-job",
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events?type=job.recovered&workflowId=workflow-restart",
    });
    const retryResponse = await app.inject({
      method: "POST",
      url: "/workflows/workflow-restart/retry",
    });
    const retry = retryResponse.json();

    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json()).toMatchObject({
      id: "running-job",
      status: "failed",
      error: "Job was interrupted by API restart.",
    });
    expect(workflowResponse.statusCode).toBe(200);
    expect(workflowResponse.json()).toMatchObject({
      id: "workflow-restart",
      status: "aborted",
      tasks: [
        expect.objectContaining({
          id: "running-task",
          status: "canceled",
          result: expect.objectContaining({
            status: "canceled",
            metadata: expect.objectContaining({
              interrupted: "api_restart",
            }),
          }),
        }),
        expect.objectContaining({
          id: "waiting-task",
          status: "waiting",
        }),
      ],
      qualityGates: [
        expect.objectContaining({
          id: "running-gate",
          status: "canceled",
          result: expect.objectContaining({
            status: "canceled",
            metadata: expect.objectContaining({
              interrupted: "api_restart",
            }),
          }),
        }),
      ],
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "job.recovered",
        actor: "system",
        workflowId: "workflow-restart",
        jobId: "running-job",
        metadata: expect.objectContaining({
          previousStatus: "running",
          recoveredStatus: "failed",
          workflowRecovered: "true",
          previousWorkflowStatus: "running",
          recoveredWorkflowStatus: "aborted",
        }),
      }),
    );
    expect(retryResponse.statusCode).toBe(200);
    expect(retry).toMatchObject({
      id: "workflow-restart",
      status: "ready",
      tasks: expect.arrayContaining([
        expect.objectContaining({
          id: "running-task",
          status: "waiting",
        }),
      ]),
      qualityGates: expect.arrayContaining([
        expect.objectContaining({
          id: "running-gate",
          status: "waiting",
        }),
      ]),
    });
    expect(retry.tasks[0]?.result).toBeUndefined();
    expect(retry.qualityGates[0]?.result).toBeUndefined();
  });

  it("resumes persisted queued jobs when the API is rebuilt", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-queued-resume-test-"),
    );
    const stateRoot = join(demoRoot, ".mawo", "state");
    tempRoots.push(demoRoot);
    await mkdir(stateRoot, { recursive: true });
    await writeFile(
      join(stateRoot, "jobs.json"),
      JSON.stringify(
        [
          {
            id: "queued-job",
            workflowId: "workflow-queued",
            status: "queued",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      join(stateRoot, "workflows.json"),
      JSON.stringify(
        [
          {
            id: "workflow-queued",
            goal: "Resume queued workflow",
            status: "ready",
            executionMode: "direct",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z",
            tasks: [
              {
                id: "queued-task",
                title: "Queued task",
                agent: "shell",
                command: `${node} -e "console.log('resumed by rebuilt api')"`,
                status: "waiting",
              },
            ],
            qualityGates: [],
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const app = buildApp(undefined, { demoRoot });
    let job = { status: "queued" };
    for (
      let attempt = 0;
      attempt < 20 && job.status !== "completed";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const jobResponse = await app.inject({
        method: "GET",
        url: "/jobs/queued-job",
      });
      job = jobResponse.json();
    }
    const workflowResponse = await app.inject({
      method: "GET",
      url: "/workflows/workflow-queued",
    });

    expect(job).toMatchObject({
      id: "queued-job",
      workflowId: "workflow-queued",
      status: "completed",
    });
    expect(workflowResponse.json()).toMatchObject({
      id: "workflow-queued",
      status: "needs_review",
    });
  });

  it("registers repositories and restores them across API rebuilds", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-repository-registry-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const firstApp = buildApp(undefined, { demoRoot });

    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Registered repo",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [
          {
            id: "readme",
            title: "README exists",
            command: `${node} -e "const fs = require('fs'); if (!fs.existsSync('README.md')) process.exit(1)"`,
          },
        ],
      },
    });
    const created = createResponse.json();
    const secondApp = buildApp(undefined, { demoRoot });
    const listResponse = await secondApp.inject({
      method: "GET",
      url: "/repositories",
    });
    const restored = listResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created).toMatchObject({
      name: "Registered repo",
      path: repoPath,
      defaultBranch: "main",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(restored).toEqual([
      expect.objectContaining({
        id: created.id,
        path: repoPath,
        qualityGates: [
          expect.objectContaining({
            id: "readme",
          }),
        ],
      }),
    ]);
  });

  it("returns repository safety for a registered repository", async () => {
    const repository = {
      id: "repo-safety",
      name: "Safety repo",
      path: "C:/work/safety-repo",
      defaultBranch: "main",
      qualityGates: [],
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    };
    const repositoryStore = {
      async list() {
        return [repository];
      },
      async get(id: string) {
        return id === repository.id ? repository : undefined;
      },
      async upsert() {
        return {
          repository,
          created: false,
        };
      },
      async remove() {
        return undefined;
      },
    } as unknown as RepositoryStore;
    const app = buildApp(undefined, {
      repositoryStore,
      repositorySafetyInspector: async ({ repository: checkedRepository }) => ({
        repositoryId: checkedRepository.id,
        path: checkedRepository.path,
        defaultBranch: checkedRepository.defaultBranch,
        currentBranch: "feature/repository-safety",
        headShortSha: "abc1234",
        clean: true,
        dirty: false,
        allowedRoot: true,
        noAutoMerge: true,
        manualApplyPolicy:
          "Manual review is required; MAWO never automatically merges repository changes.",
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/repositories/repo-safety/safety",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      repositoryId: "repo-safety",
      path: "C:/work/safety-repo",
      defaultBranch: "main",
      currentBranch: "feature/repository-safety",
      headShortSha: "abc1234",
      clean: true,
      dirty: false,
      allowedRoot: true,
      noAutoMerge: true,
      manualApplyPolicy:
        "Manual review is required; MAWO never automatically merges repository changes.",
    });
  });

  it("records an audit event when a repository is registered", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-repository-audit-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Audited repo",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [
          {
            id: "test",
            title: "Test gate",
            command: "npm test",
          },
        ],
      },
    });
    const created = createResponse.json();
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events",
    });

    expect(createResponse.statusCode).toBe(201);
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "repository.registered",
        actor: "operator",
        metadata: expect.objectContaining({
          repositoryId: created.id,
          repositoryName: "Audited repo",
          repositoryPath: repoPath,
          qualityGates: "1",
        }),
      }),
    );
  });

  it("awaits asynchronous repository and audit stores during registration", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-async-store-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const repositories: RepositoryUpsertResult["repository"][] = [];
    const auditEvents: AuditEvent[] = [];
    const repositoryStore = {
      async list() {
        return repositories;
      },
      async get(id: string) {
        return repositories.find((repository) => repository.id === id);
      },
      async upsert(input: RepositoryRegistrationRequest) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const now = "2026-06-05T00:00:00.000Z";
        const repository = {
          id: "async-repository",
          name: input.name,
          path: repoPath,
          defaultBranch: input.defaultBranch,
          qualityGates: input.qualityGates,
          createdAt: now,
          updatedAt: now,
        };

        repositories.push(repository);

        return {
          repository,
          created: true,
        };
      },
      async remove(id: string) {
        const index = repositories.findIndex(
          (repository) => repository.id === id,
        );
        if (index < 0) {
          return undefined;
        }

        return repositories.splice(index, 1)[0];
      },
    } as unknown as RepositoryStore;
    const auditStore = {
      async list() {
        return auditEvents;
      },
      async append(input: AuditEventInput) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const event = {
          ...input,
          id: "async-audit-event",
          createdAt: "2026-06-05T00:00:01.000Z",
        };

        auditEvents.push(event);

        return event;
      },
    } as unknown as AuditStore;
    const app = buildApp(undefined, {
      auditStore,
      demoRoot,
      repositoryStore,
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Async store repo",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [],
      },
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/repositories",
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events",
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      id: "async-repository",
      name: "Async store repo",
      path: repoPath,
    });
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        id: "async-repository",
      }),
    ]);
    expect(auditResponse.json()).toEqual([
      expect.objectContaining({
        type: "repository.registered",
        metadata: expect.objectContaining({
          repositoryId: "async-repository",
          repositoryPath: repoPath,
        }),
      }),
    ]);
  });

  it("awaits asynchronous workflow and job stores before serving runtime reads", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-async-runtime-test-"),
    );
    tempRoots.push(demoRoot);
    const workflow: LocalWorkflowRun = {
      id: "async-workflow",
      goal: "Restore async runtime state",
      status: "needs_review",
      executionMode: "direct",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:01:00.000Z",
      tasks: [],
      qualityGates: [],
    };
    const job: WorkflowJob = {
      id: "async-job",
      workflowId: workflow.id,
      status: "completed",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:02:00.000Z",
      startedAt: "2026-06-05T00:00:30.000Z",
      finishedAt: "2026-06-05T00:02:00.000Z",
    };
    const runStore = {
      async list() {
        await delay(5);
        return [workflow];
      },
      async save() {
        await delay(5);
      },
    } as RunStore;
    const jobStore = {
      async list() {
        await delay(5);
        return [job];
      },
      async save() {
        await delay(5);
      },
    } as JobStore;
    const app = buildApp(undefined, {
      demoRoot,
      jobStore,
      runStore,
    });

    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${workflow.id}`,
    });
    const jobResponse = await app.inject({
      method: "GET",
      url: `/jobs/${job.id}`,
    });

    expect(workflowResponse.statusCode).toBe(200);
    expect(workflowResponse.json()).toMatchObject({
      id: workflow.id,
      status: "needs_review",
    });
    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json()).toMatchObject({
      id: job.id,
      workflowId: workflow.id,
      status: "completed",
    });
  });

  it("awaits asynchronous workflow and job saves before write responses", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-async-save-test-"));
    tempRoots.push(demoRoot);
    const savedWorkflows: LocalWorkflowRun[] = [];
    const savedJobs: WorkflowJob[] = [];
    const runStore = {
      async list() {
        return [];
      },
      async save(run: LocalWorkflowRun) {
        const snapshot = structuredClone(run);
        await delay(5);
        savedWorkflows.push(snapshot);
      },
    } as RunStore;
    const jobStore = {
      async list() {
        return [];
      },
      async save(job: WorkflowJob) {
        const snapshot = { ...job };
        await delay(5);
        savedJobs.push(snapshot);
      },
    } as JobStore;
    const app = buildApp(undefined, {
      demoRoot,
      jobStore,
      runStore,
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(savedWorkflows).toEqual([
      expect.objectContaining({
        id: created.id,
        status: "ready",
      }),
    ]);

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`,
    });
    const job = enqueueResponse.json();

    expect(enqueueResponse.statusCode).toBe(202);
    expect(savedJobs).toEqual([
      expect.objectContaining({
        id: job.id,
        workflowId: created.id,
        status: "queued",
      }),
    ]);
  });

  it("uses Prisma stores when the postgres state backend is requested", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-postgres-state-test-"),
    );
    tempRoots.push(demoRoot);
    const createdAt = new Date("2026-06-05T00:00:00.000Z");
    const updatedAt = new Date("2026-06-05T00:01:00.000Z");
    const repository = {
      id: "postgres-repository",
      name: "Postgres repo",
      path: demoRoot,
      defaultBranch: "main",
      qualityGates: [],
      createdAt,
      updatedAt,
    };
    const workflow = {
      id: "postgres-workflow",
      goal: "Restore from postgres",
      status: "needs_review",
      executionMode: "direct",
      repositoryId: repository.id,
      repositoryPath: repository.path,
      worktreeRoot: null,
      reviewDecision: null,
      reviewNote: null,
      reviewedAt: null,
      createdAt,
      updatedAt,
      tasks: [],
      qualityGates: [],
    };
    const job = {
      id: "postgres-job",
      workflowRunId: workflow.id,
      status: "completed",
      error: null,
      createdAt,
      updatedAt,
      startedAt: createdAt,
      finishedAt: updatedAt,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      attempts: 0,
    };
    const auditEvent = {
      id: "postgres-audit",
      type: "workflow.created",
      actor: "operator",
      workflowRunId: workflow.id,
      jobId: null,
      metadata: {
        repositoryId: repository.id,
      },
      createdAt,
    };
    const prismaClient = {
      repositoryRecord: {
        findMany: vi.fn(async () => [repository]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      workflowRun: {
        findMany: vi.fn(async () => [workflow]),
        upsert: vi.fn(),
      },
      workflowTaskRun: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      qualityGateRun: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      workflowJob: {
        findMany: vi.fn(async () => [job]),
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(),
      },
      auditEvent: {
        findMany: vi.fn(async () => [auditEvent]),
        create: vi.fn(),
      },
    };
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_STATE_BACKEND: "postgres",
        DATABASE_URL: "postgresql://mawo:secret@localhost:5432/mawo",
      },
      prismaClient,
    });

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/readiness",
    });
    const repositoriesResponse = await app.inject({
      method: "GET",
      url: "/repositories",
    });
    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${workflow.id}`,
    });
    const jobResponse = await app.inject({
      method: "GET",
      url: `/jobs/${job.id}`,
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events",
    });

    expect(readinessResponse.statusCode).toBe(200);
    expect(readinessResponse.json().checks).toContainEqual(
      expect.objectContaining({
        id: "runtime_backend",
        ok: true,
        requestedStateBackend: "postgres",
        activeStateBackend: "postgres",
        requestedQueueBackend: "in_process",
        activeQueueBackend: "in_process",
      }),
    );
    expect(repositoriesResponse.json()).toEqual([
      expect.objectContaining({
        id: repository.id,
        name: repository.name,
      }),
    ]);
    expect(workflowResponse.json()).toMatchObject({
      id: workflow.id,
      repositoryId: repository.id,
      status: "needs_review",
    });
    expect(jobResponse.json()).toMatchObject({
      id: job.id,
      workflowId: workflow.id,
      status: "completed",
    });
    expect(auditResponse.json()).toEqual([
      expect.objectContaining({
        id: auditEvent.id,
        workflowId: workflow.id,
      }),
    ]);
  });

  it("uses postgres queue storage for API enqueue, listing, and cancel without running in the API", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-postgres-queue-test-"),
    );
    tempRoots.push(demoRoot);
    const { prismaClient, workflowJobs } = createMutablePrismaStateClient();
    const runner = new LocalRunner();
    const runWorkflow = vi
      .spyOn(runner, "runWorkflow")
      .mockImplementation(
        async (workflowId) => runner.getWorkflow(workflowId)!,
      );
    const app = buildApp(runner, {
      demoRoot,
      env: {
        MAWO_STATE_BACKEND: "postgres",
        MAWO_QUEUE_BACKEND: "postgres",
        DATABASE_URL: "postgresql://mawo:secret@localhost:5432/mawo",
      },
      prismaClient,
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`,
    });
    const queued = enqueueResponse.json();
    await delay(20);
    const queuedJobsResponse = await app.inject({
      method: "GET",
      url: `/jobs?status=queued&workflowId=${created.id}`,
    });
    const jobResponse = await app.inject({
      method: "GET",
      url: `/jobs/${queued.id}`,
    });
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/jobs/${queued.id}/cancel`,
    });
    const canceled = cancelResponse.json();
    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}`,
    });

    expect(enqueueResponse.statusCode).toBe(202);
    expect(queued).toMatchObject({
      id: expect.any(String),
      workflowId: created.id,
      status: "queued",
    });
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(workflowJobs).toHaveLength(1);
    expect(workflowJobs[0]).toMatchObject({
      id: queued.id,
      workflowRunId: created.id,
      status: "canceled",
    });
    expect(queuedJobsResponse.statusCode).toBe(200);
    expect(queuedJobsResponse.json()).toEqual([
      expect.objectContaining({
        id: queued.id,
        workflowId: created.id,
        status: "queued",
      }),
    ]);
    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json()).toMatchObject({
      id: queued.id,
      workflowId: created.id,
      status: "queued",
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(canceled).toMatchObject({
      id: queued.id,
      workflowId: created.id,
      status: "canceled",
      finishedAt: expect.any(String),
    });
    expect(workflowResponse.json()).toMatchObject({
      id: created.id,
      status: "ready",
    });
  });

  it("updates existing repository registrations for the same normalized path", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-repository-upsert-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Original repo",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [],
      },
    });
    const created = createResponse.json();
    const updateResponse = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Updated repo",
        path: `${repoPath}${sep}.`,
        defaultBranch: "develop",
        qualityGates: [
          {
            id: "test",
            title: "Test gate",
            command: "npm test",
          },
        ],
      },
    });
    const updated = updateResponse.json();
    const listResponse = await app.inject({
      method: "GET",
      url: "/repositories",
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events",
    });

    expect(createResponse.statusCode).toBe(201);
    expect(updateResponse.statusCode).toBe(200);
    expect(updated).toMatchObject({
      id: created.id,
      name: "Updated repo",
      path: repoPath,
      defaultBranch: "develop",
      createdAt: created.createdAt,
      qualityGates: [
        expect.objectContaining({
          id: "test",
          command: "npm test",
        }),
      ],
    });
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Updated repo",
        path: repoPath,
      }),
    ]);
    expect(auditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "repository.updated",
        actor: "operator",
        metadata: expect.objectContaining({
          repositoryId: created.id,
          previousRepositoryName: "Original repo",
          repositoryName: "Updated repo",
          repositoryPath: repoPath,
          defaultBranch: "develop",
          qualityGates: "1",
        }),
      }),
    );
  });

  it("deletes repository registrations and records an audit event", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-repository-delete-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const firstApp = buildApp(undefined, { demoRoot });

    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Delete me",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: [],
      },
    });
    const created = createResponse.json();
    const deleteResponse = await firstApp.inject({
      method: "DELETE",
      url: `/repositories/${created.id}`,
    });
    const secondDeleteResponse = await firstApp.inject({
      method: "DELETE",
      url: `/repositories/${created.id}`,
    });
    const secondApp = buildApp(undefined, { demoRoot });
    const listResponse = await secondApp.inject({
      method: "GET",
      url: "/repositories",
    });
    const auditResponse = await secondApp.inject({
      method: "GET",
      url: "/audit-events",
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      id: created.id,
      name: "Delete me",
      path: repoPath,
    });
    expect(secondDeleteResponse.statusCode).toBe(404);
    expect(secondDeleteResponse.json()).toMatchObject({
      error: "repository_not_found",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([]);
    expect(auditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "repository.deleted",
        actor: "operator",
        metadata: expect.objectContaining({
          repositoryId: created.id,
          repositoryName: "Delete me",
          repositoryPath: repoPath,
        }),
      }),
    );
  });

  it("rejects repository registration outside configured allowed roots", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-allowlist-test-"));
    const allowedRoot = await mkdtemp(join(tmpdir(), "mawo-api-allowed-root-"));
    const disallowedRepo = await createCommittedRepo();
    tempRoots.push(demoRoot, allowedRoot);
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_ALLOWED_REPOSITORY_ROOTS: allowedRoot,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Disallowed repo",
        path: disallowedRepo,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "repository_path_not_allowed",
    });
  });

  it("rejects direct repository workflows outside configured allowed roots", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-workflow-allowlist-test-"),
    );
    const allowedRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-workflow-allowed-root-"),
    );
    const disallowedRepo = await createCommittedRepo();
    tempRoots.push(demoRoot, allowedRoot);
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_ALLOWED_REPOSITORY_ROOTS: allowedRoot,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Should be blocked",
        repositoryPath: disallowedRepo,
        tasks: [
          {
            id: "noop",
            agent: "shell",
            command: `${node} -e "console.log('noop')"`,
          },
        ],
        qualityGates: [],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "repository_path_not_allowed",
    });
  });

  it("creates repository workflows from a registered repository id", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-registered-workflow-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });
    const repositoryResponse = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Registered workflow repo",
        path: repoPath,
        qualityGates: [
          {
            id: "readme-gate",
            title: "README has registered marker",
            command: `${node} -e "const fs = require('fs'); if (!fs.readFileSync('README.md', 'utf8').includes('registered workflow')) process.exit(1)"`,
          },
        ],
      },
    });
    const repository = repositoryResponse.json();

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Use a registered repository",
        repositoryId: repository.id,
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'registered workflow\\\\n')"`,
          },
        ],
      },
    });
    const created = createResponse.json();
    const unrelatedReadyWorkflow = (
      await app.inject({ method: "POST", url: "/workflows/demo" })
    ).json();
    const filteredWorkflowResponse = await app.inject({
      method: "GET",
      url: `/workflows?status=ready&repositoryId=${repository.id}&limit=10`,
    });
    const workflowCreatedAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=workflow.created&repositoryId=${repository.id}`,
    });
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = runResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.repositoryId).toBe(repository.id);
    expect(created.repositoryPath).toBe(repoPath);
    expect(created.qualityGates[0]).toMatchObject({
      id: "readme-gate",
      title: "README has registered marker",
    });
    expect(filteredWorkflowResponse.statusCode).toBe(200);
    expect(
      filteredWorkflowResponse
        .json()
        .map((workflow: { id: string }) => workflow.id),
    ).toEqual([created.id]);
    expect(filteredWorkflowResponse.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: unrelatedReadyWorkflow.id }),
      ]),
    );
    expect(workflowCreatedAuditResponse.statusCode).toBe(200);
    expect(workflowCreatedAuditResponse.json()).toContainEqual(
      expect.objectContaining({
        type: "workflow.created",
        workflowId: created.id,
        metadata: expect.objectContaining({
          repositoryId: repository.id,
          repositoryPath: repoPath,
        }),
      }),
    );
    expect(runResponse.statusCode).toBe(200);
    expect(completed.repositoryId).toBe(repository.id);
    expect(completed.status).toBe("needs_review");
    expect(completed.qualityGates[0].status).toBe("passed");
  });

  it("enqueues workflow runs and exposes job status", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`,
    });
    const queued = enqueueResponse.json();

    expect(enqueueResponse.statusCode).toBe(202);
    expect(queued.status).toBe("queued");
    expect(queued.workflowId).toBe(created.id);

    let job = queued;
    for (
      let attempt = 0;
      attempt < 20 && job.status !== "completed";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const jobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${queued.id}`,
      });
      job = jobResponse.json();
    }

    expect(job.status).toBe("completed");

    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}`,
    });
    const workflow = workflowResponse.json();

    expect(workflow.status).toBe("needs_review");
  });

  it("honors MAWO_MAX_CONCURRENT_JOBS when processing enqueued workflows", async () => {
    const runner = new LocalRunner();
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let firstStarted = false;
    vi.spyOn(runner, "runWorkflow").mockImplementation(async (workflowId) => {
      started.push(workflowId);

      if (!firstStarted) {
        firstStarted = true;
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }

      return runner.getWorkflow(workflowId)!;
    });
    const app = buildApp(runner, {
      env: {
        MAWO_MAX_CONCURRENT_JOBS: "1",
      },
    });
    const firstCreateResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const secondCreateResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const firstWorkflow = firstCreateResponse.json();
    const secondWorkflow = secondCreateResponse.json();

    const firstEnqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${firstWorkflow.id}/enqueue`,
    });
    const secondEnqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${secondWorkflow.id}/enqueue`,
    });
    const firstJob = firstEnqueueResponse.json();
    const secondJob = secondEnqueueResponse.json();

    for (let attempt = 0; attempt < 20; attempt++) {
      const firstJobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${firstJob.id}`,
      });

      if (firstJobResponse.json().status === "running") {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const queuedSecondJobResponse = await app.inject({
      method: "GET",
      url: `/jobs/${secondJob.id}`,
    });

    expect(queuedSecondJobResponse.json()).toMatchObject({
      id: secondJob.id,
      workflowId: secondWorkflow.id,
      status: "queued",
    });
    expect(started).toEqual([firstWorkflow.id]);

    releaseFirst?.();
    let completedSecondJob = queuedSecondJobResponse.json();
    for (
      let attempt = 0;
      attempt < 20 && completedSecondJob.status !== "completed";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const secondJobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${secondJob.id}`,
      });
      completedSecondJob = secondJobResponse.json();
    }

    expect(completedSecondJob.status).toBe("completed");
    expect(started).toEqual([firstWorkflow.id, secondWorkflow.id]);
  });

  it("rejects duplicate enqueue requests while a workflow job is active", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    const [enqueueResponse, duplicateResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/workflows/${created.id}/enqueue`,
      }),
      app.inject({
        method: "POST",
        url: `/workflows/${created.id}/enqueue`,
      }),
    ]);
    const acceptedResponse =
      enqueueResponse.statusCode === 202 ? enqueueResponse : duplicateResponse;
    const rejectedResponse =
      enqueueResponse.statusCode === 409 ? enqueueResponse : duplicateResponse;
    const queued = acceptedResponse.json();
    const duplicate = rejectedResponse.json();

    await vi.runAllTimersAsync();

    expect(
      [enqueueResponse.statusCode, duplicateResponse.statusCode].sort(),
    ).toEqual([202, 409]);
    expect(rejectedResponse.statusCode).toBe(409);
    expect(acceptedResponse.statusCode).toBe(202);
    expect(duplicate).toMatchObject({
      error: "workflow_already_running",
      job: {
        id: queued.id,
        workflowId: created.id,
        status: "queued",
      },
    });
  });

  it("rejects duplicate enqueue while running and releases the slot after cancel settles", async () => {
    const runner = new LocalRunner();
    const app = buildApp(runner);
    const run = runner.createWorkflow({
      goal: "Reject duplicate running jobs",
      tasks: [
        {
          id: "slow-task",
          title: "Slow task",
          agent: "shell",
          command: `${node} -e "setTimeout(() => console.log('done'), 1200)"`,
        },
      ],
      qualityGates: [],
    });

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${run.id}/enqueue`,
    });
    const queued = enqueueResponse.json();

    let runningJob = queued;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const jobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${queued.id}`,
      });
      runningJob = jobResponse.json();
      if (runningJob.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/workflows/${run.id}/enqueue`,
    });
    const duplicate = duplicateResponse.json();
    await app.inject({
      method: "POST",
      url: `/jobs/${queued.id}/cancel`,
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const workflowResponse = await app.inject({
        method: "GET",
        url: `/workflows/${run.id}`,
      });
      if (workflowResponse.json().status === "aborted") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const nextEnqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${run.id}/enqueue`,
    });
    const nextJob = nextEnqueueResponse.json();
    await app.inject({
      method: "POST",
      url: `/jobs/${nextJob.id}/cancel`,
    });

    expect(enqueueResponse.statusCode).toBe(202);
    expect(runningJob.status).toBe("running");
    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicate).toMatchObject({
      error: "workflow_already_running",
      job: {
        id: queued.id,
        workflowId: run.id,
        status: "running",
      },
    });
    expect(nextEnqueueResponse.statusCode).toBe(202);
    expect(nextJob.id).not.toBe(queued.id);
  });

  it("cancels queued workflow jobs through the jobs API", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`,
    });
    const queued = enqueueResponse.json();

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/jobs/${queued.id}/cancel`,
    });
    const canceled = cancelResponse.json();

    await vi.runAllTimersAsync();
    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}`,
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(canceled.status).toBe("canceled");
    expect(workflowResponse.json().status).toBe("ready");
  });

  it("returns queued requirement jobs to ready_to_run when canceled before execution", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-requirement-cancel-test-"),
    );
    tempRoots.push(demoRoot);
    const repoPath = await createCommittedRepo();
    const { prismaClient } = createMutablePrismaStateClient();
    const runner = new LocalRunner();
    const runWorkflow = vi
      .spyOn(runner, "runWorkflow")
      .mockImplementation(
        async (workflowId) => runner.getWorkflow(workflowId)!,
      );
    const app = buildApp(runner, {
      demoRoot,
      env: {
        MAWO_STATE_BACKEND: "postgres",
        MAWO_QUEUE_BACKEND: "postgres",
        DATABASE_URL: "postgresql://mawo:secret@localhost:5432/mawo",
      },
      prismaClient,
      repositorySafetyInspector: async ({ repository }) => ({
        repositoryId: repository.id,
        path: repository.path,
        clean: true,
        dirty: false,
        allowedRoot: true,
        noAutoMerge: true,
        manualApplyPolicy: "Manual git apply only",
      }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/requirements",
      payload: {
        title: "Cancel queued requirement",
        repositoryPath: repoPath,
        goal: "Cancel a queued requirement without leaving stale running state",
        acceptanceCriteria: ["Canceled queued jobs return to ready to run"],
        tasks: [
          {
            id: "task-1",
            title: "Patch README",
            agent: "shell",
            command: `${node} -e "require('fs').appendFileSync('README.md','cancel\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "gate-1",
            title: "Unit tests",
            command: `${node} -e "process.exit(0)"`,
            required: true,
          },
        ],
      },
    });
    const requirement = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/confirm-plan`,
    });
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/requirements/${requirement.id}/enqueue`,
    });
    expect(enqueueResponse.statusCode).toBe(202);
    const enqueueBody = enqueueResponse.json();

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/jobs/${enqueueBody.job.id}/cancel`,
    });
    const requirementResponse = await app.inject({
      method: "GET",
      url: `/requirements/${requirement.id}`,
    });

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(enqueueBody.requirement).toMatchObject({
      id: requirement.id,
      status: "running",
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toMatchObject({
      status: "canceled",
      workflowId: enqueueBody.workflow.id,
    });
    expect(requirementResponse.json()).toMatchObject({
      id: requirement.id,
      status: "ready_to_run",
      currentWorkflowRunId: enqueueBody.workflow.id,
      runLinks: [
        expect.objectContaining({
          workflowRunId: enqueueBody.workflow.id,
          status: "ready",
        }),
      ],
    });
  });

  it("approves a review-ready workflow", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve",
        note: "Looks ready",
      },
    });
    const reviewed = reviewResponse.json();

    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewed.status).toBe("completed");
    expect(reviewed.review).toMatchObject({
      decision: "approved",
      note: "Looks ready",
    });
  });

  it("returns a merge candidate artifact for review-ready worktree workflows", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-merge-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });

    const candidateResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/merge-candidate`,
    });
    const candidate = candidateResponse.json();

    expect(candidateResponse.statusCode).toBe(200);
    expect(candidate.status).toBe("ready");
    expect(candidate.patch).toContain("+worktree runner");
    expect(candidate.patchArtifactPath).toContain("merge-candidate.patch");
    expect(candidate.manifestArtifactPath).toContain("merge-candidate.json");
    expect(candidate.applyCommand).toContain("git -C");
  });

  it("applies a ready merge candidate to a clean repository and audits it", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-apply-test-"));
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Apply a reviewed patch",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'applied merge candidate\\\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "readme",
            title: "README changed",
            command: `${node} -e "const fs = require('fs'); if (!fs.readFileSync('README.md', 'utf8').includes('applied merge candidate')) process.exit(1)"`,
          },
        ],
      },
    });
    const created = createResponse.json();
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });

    const applyResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/merge-candidate/apply`,
    });
    const applyResult = applyResponse.json();
    const readme = await readFile(join(repoPath, "README.md"), "utf8");
    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=workflow.merge_candidate_applied&workflowId=${created.id}`,
    });
    const auditEvents = auditResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(runResponse.json().status).toBe("needs_review");
    expect(applyResponse.statusCode).toBe(200);
    expect(applyResult).toMatchObject({
      workflowId: created.id,
      status: "applied",
      repositoryPath: repoPath,
      sourceBranches: expect.arrayContaining([
        expect.stringContaining("mawo/"),
      ]),
    });
    expect(applyResult.gitStatus).toContain("README.md");
    expect(readme).toContain("applied merge candidate");
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      type: "workflow.merge_candidate_applied",
      actor: "operator",
      workflowId: created.id,
      metadata: expect.objectContaining({
        status: "applied",
        repositoryPath: repoPath,
      }),
    });
  });

  it("blocks applying a merge candidate when the target repository is dirty", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-apply-dirty-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Reject applying over local changes",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'dirty apply candidate\\\\n')"`,
          },
        ],
        qualityGates: [],
      },
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    await writeFile(join(repoPath, "LOCAL.txt"), "operator change\n", "utf8");

    const applyResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/merge-candidate/apply`,
    });

    expect(applyResponse.statusCode).toBe(409);
    expect(applyResponse.json()).toMatchObject({
      error: "merge_candidate_apply_blocked",
      reason: "repository_not_clean",
    });
  });

  it("blocks merge candidates for workflows that failed quality gates", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-merge-block-test-"),
    );
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Block merge candidate until gates pass",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'blocked API candidate\\\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "unit",
            title: "Unit tests",
            command: `${node} -e "process.exit(8)"`,
          },
        ],
      },
    });
    const created = createResponse.json();
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const candidateResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/merge-candidate`,
    });

    expect(createResponse.statusCode).toBe(201);
    expect(runResponse.json()).toMatchObject({
      status: "gate_failed",
      tasks: [
        expect.objectContaining({
          diff: expect.objectContaining({
            patch: expect.stringContaining("+blocked API candidate"),
          }),
        }),
      ],
    });
    expect(candidateResponse.statusCode).toBe(409);
    expect(candidateResponse.json()).toMatchObject({
      error: "merge_candidate_not_ready",
      status: "gate_failed",
    });
  });

  it("cleans completed workflow workspaces through the API", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-cleanup-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const reviewReady = runResponse.json();
    const blockedCleanupResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/workspaces/cleanup`,
    });
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve",
        note: "Clean it",
      },
    });
    const cleanupResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/workspaces/cleanup`,
    });
    const cleanup = cleanupResponse.json();
    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?workflowId=${created.id}`,
    });
    const cleanupAuditEvents = auditResponse
      .json()
      .filter(
        (event: { type: string }) =>
          event.type === "workflow.workspaces_cleaned",
      );

    expect(blockedCleanupResponse.statusCode).toBe(409);
    expect(cleanupResponse.statusCode).toBe(200);
    expect(cleanup).toMatchObject({
      workflowId: created.id,
      status: "cleaned",
      cleaned: [
        expect.objectContaining({
          taskId: "worktree-edit",
          path: reviewReady.tasks[0].workspace.path,
        }),
      ],
    });
    expect(cleanupAuditEvents).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          status: "cleaned",
          cleanedCount: "1",
          cleanedTaskIds: "worktree-edit",
          cleanedBranches: expect.stringContaining("worktree-edit"),
          cleanedPaths: reviewReady.tasks[0].workspace.path,
        }),
      }),
    );
  });

  it("previews workflow workspace cleanup readiness through the API", async () => {
    const demoRoot = await mkdtemp(
      join(tmpdir(), "mawo-api-cleanup-preview-test-"),
    );
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo",
    });
    const created = createResponse.json();
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const reviewReady = runResponse.json();
    const blockedPreviewResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/workspaces`,
    });
    const blockedPreview = blockedPreviewResponse.json();

    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve",
        note: "Preview cleanup",
      },
    });
    const allowedPreviewResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/workspaces`,
    });
    const cleanupResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/workspaces/cleanup`,
    });
    const emptyPreviewResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/workspaces`,
    });

    expect(blockedPreviewResponse.statusCode).toBe(200);
    expect(blockedPreview).toMatchObject({
      workflowId: created.id,
      workflowStatus: "needs_review",
      cleanupAllowed: false,
      workspaceCount: 1,
      existingCount: 1,
      blockedReason:
        "Workflow is needs_review; workspaces can only be cleaned after completion or abort.",
      workspaces: [
        expect.objectContaining({
          taskId: "worktree-edit",
          taskTitle: "Edit demo repository",
          path: reviewReady.tasks[0].workspace.path,
          exists: true,
          cleanupAllowed: false,
        }),
      ],
    });
    expect(allowedPreviewResponse.statusCode).toBe(200);
    expect(allowedPreviewResponse.json()).toMatchObject({
      workflowId: created.id,
      workflowStatus: "completed",
      cleanupAllowed: true,
      workspaceCount: 1,
      existingCount: 1,
      workspaces: [
        expect.objectContaining({
          cleanupAllowed: true,
        }),
      ],
    });
    expect(cleanupResponse.statusCode).toBe(200);
    expect(emptyPreviewResponse.statusCode).toBe(200);
    expect(emptyPreviewResponse.json()).toMatchObject({
      workflowId: created.id,
      workflowStatus: "completed",
      cleanupAllowed: true,
      workspaceCount: 0,
      existingCount: 0,
      workspaces: [],
    });
  });

  it("rejects review decisions before a workflow is review-ready", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo",
    });
    const created = createResponse.json();

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve",
      },
    });

    expect(reviewResponse.statusCode).toBe(409);
    expect(reviewResponse.json()).toMatchObject({
      error: "workflow_not_review_ready",
    });
  });

  it("creates repository workflows from a real repo path", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-real-repo-test-"));
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Run against a user repository",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "edit-readme",
            title: "Edit README",
            agent: "shell",
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'real repo workflow\\\\n')"`,
          },
        ],
        qualityGates: [
          {
            id: "readme",
            title: "README changed",
            command: `${node} -e "const fs = require('fs'); if (!fs.readFileSync('README.md', 'utf8').includes('real repo workflow')) process.exit(1)"`,
          },
        ],
      },
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.executionMode).toBe("worktree");
    expect(created.repositoryPath).toBe(repoPath);
    expect(created.worktreeRoot).toContain("repository-worktrees");

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0].workspace.repoPath).toBe(repoPath);
    expect(completed.tasks[0].diff.patch).toContain("+real repo workflow");
    expect(completed.qualityGates[0].status).toBe("passed");
  });

  it("keeps repository workflow task timeouts from API requests", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-timeout-test-"));
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Run timeout bounded task",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "slow-task",
            title: "Slow task",
            agent: "shell",
            command: `${node} -e "setTimeout(() => console.log('too late'), 1000)"`,
            timeoutMs: 50,
          },
        ],
        qualityGates: [],
      },
    });
    const created = createResponse.json();

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = runResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("failed");
    expect(completed.tasks[0].result.metadata.timedOut).toBe("true");
  });

  it("resets failed repository workflows through the retry endpoint", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-retry-test-"));
    const repoPath = await createCommittedRepo();
    const counterPath = join(demoRoot, "attempts.txt").replace(/\\/g, "\\\\");
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Retry a transient repository task",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "flaky-task",
            title: "Flaky task",
            agent: "shell",
            command: `${node} -e "const fs = require('fs'); const p = '${counterPath}'; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) + 1 : 1; fs.writeFileSync(p, String(n)); console.log('attempt ' + n); if (n < 2) process.exit(7);"`,
          },
        ],
        qualityGates: [],
      },
    });
    const created = createResponse.json();

    const failedResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const failed = failedResponse.json();
    const retryResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/retry`,
    });
    const retried = retryResponse.json();
    const rerunResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`,
    });
    const completed = rerunResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(failed.status).toBe("failed");
    expect(retryResponse.statusCode).toBe(200);
    expect(retried.status).toBe("ready");
    expect(retried.tasks[0].status).toBe("waiting");
    expect(retried.tasks[0].result).toBeUndefined();
    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0].result.stdout).toContain("attempt 2");
  });

  it("rejects repository workflows when the repo has no committed HEAD", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-bad-repo-test-"));
    const repoPath = await mkdtemp(join(tmpdir(), "mawo-server-empty-repo-"));
    tempRoots.push(demoRoot, repoPath);
    const app = buildApp(undefined, { demoRoot });

    await run("git init -b main", repoPath);

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/repository",
      payload: {
        goal: "Run against an uncommitted repository",
        repositoryPath: repoPath,
        tasks: [
          {
            id: "noop",
            title: "Noop",
            agent: "shell",
            command: `${node} -e "console.log('noop')"`,
          },
        ],
        qualityGates: [],
      },
    });

    expect(createResponse.statusCode).toBe(422);
    expect(createResponse.json()).toMatchObject({
      error: "repository_not_ready",
    });
  });
});
