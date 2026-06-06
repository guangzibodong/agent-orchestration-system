import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "../apps/api/src/db.js";
import {
  assertPostgresRuntimeReady,
  requireDatabaseUrl,
  type SmokeJsonObject
} from "../apps/api/src/postgres-smoke-helpers.js";
import { FileArtifactStore } from "../apps/api/src/runner/file-artifact-store.js";
import { LocalRunner } from "../apps/api/src/runner/local-runner.js";
import { PostgresWorkflowWorker } from "../apps/api/src/runner/postgres-workflow-worker.js";
import { PrismaAuditStore } from "../apps/api/src/runner/prisma-audit-store.js";
import { PrismaJobStore } from "../apps/api/src/runner/prisma-job-store.js";
import { PrismaRunStore } from "../apps/api/src/runner/prisma-run-store.js";
import { buildApp } from "../apps/api/src/server.js";

type JsonObject = SmokeJsonObject;

const tempRoots: string[] = [];

function log(message: string) {
  console.log(`[smoke:api:postgres] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runGit(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe"
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  payload?: JsonObject
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(payload ? { "content-type": "application/json" } : {}),
      ...(process.env.MAWO_API_TOKEN
        ? { authorization: `Bearer ${process.env.MAWO_API_TOKEN}` }
        : {})
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as JsonObject) : {};

  return {
    status: response.status,
    body
  };
}

async function createCommittedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-postgres-smoke-repo-"));
  tempRoots.push(repoPath);

  runGit(["init", "-b", "main"], repoPath);
  runGit(["config", "user.email", "postgres-smoke@example.com"], repoPath);
  runGit(["config", "user.name", "MAWO Postgres Smoke"], repoPath);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  runGit(["add", "README.md"], repoPath);
  runGit(["commit", "-m", "initial commit"], repoPath);

  return repoPath;
}

async function waitForJob(baseUrl: string, jobId: string): Promise<JsonObject> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await request(baseUrl, "GET", `/jobs/${jobId}`);
    assert(response.status === 200, `GET /jobs/${jobId} returned ${response.status}`);

    if (
      response.body.status === "completed" ||
      response.body.status === "failed" ||
      response.body.status === "canceled"
    ) {
      return response.body;
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for Postgres smoke job ${jobId}.`);
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(
          `[smoke:api:postgres] warning: could not remove temp root ${root}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return;
      }
      await delay(250 * (attempt + 1));
    }
  }
}

async function cleanupDatabase(ids: {
  repositoryId?: string;
  workflowId?: string;
}) {
  if (ids.workflowId) {
    await prisma.workflowRun.deleteMany({
      where: {
        id: ids.workflowId
      }
    });
  }

  if (ids.repositoryId) {
    await prisma.repositoryRecord.deleteMany({
      where: {
        id: ids.repositoryId
      }
    });
  }
}

function createPostgresSmokeWorker(root: string): PostgresWorkflowWorker {
  const auditStore = new PrismaAuditStore(prisma);
  const runner = new LocalRunner(undefined, {
    runStore: new PrismaRunStore(prisma),
    artifactStore: new FileArtifactStore({
      root: join(root, ".mawo", "artifacts")
    }),
    eventSink: (event) => {
      void auditStore
        .append({
          type: event.type,
          actor: "runner",
          workflowId: event.workflowId,
          metadata: {
            ...(event.taskId ? { taskId: event.taskId } : {}),
            ...(event.gateId ? { gateId: event.gateId } : {}),
            ...(event.status ? { status: event.status } : {}),
            ...(event.exitCode !== undefined
              ? { exitCode: String(event.exitCode) }
              : {}),
            ...(event.durationMs !== undefined
              ? { durationMs: String(event.durationMs) }
              : {})
          }
        })
        .catch((error: unknown) => {
          console.error("[smoke:api:postgres] failed to append runner audit event");
          console.error(error);
        });
    }
  });

  return new PostgresWorkflowWorker({
    runner,
    jobStore: new PrismaJobStore(prisma),
    workerId: "postgres-smoke-worker",
    leaseMs: 5 * 60 * 1000,
    renewIntervalMs: 60 * 1000
  });
}

export async function main() {
  requireDatabaseUrl();
  process.env.MAWO_STATE_BACKEND = "postgres";
  process.env.MAWO_QUEUE_BACKEND = "postgres";

  const smokeRoot = await mkdtemp(join(tmpdir(), "mawo-postgres-smoke-api-"));
  tempRoots.push(smokeRoot);
  const repositoryPath = await createCommittedRepo();
  const node = JSON.stringify(process.execPath);
  const app = buildApp(undefined, {
    demoRoot: smokeRoot,
    env: {
      ...process.env,
      MAWO_STATE_BACKEND: "postgres",
      MAWO_QUEUE_BACKEND: "postgres"
    }
  });
  const createdIds: {
    repositoryId?: string;
    workflowId?: string;
  } = {};

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert(
      address && typeof address === "object",
      "API server did not expose a TCP address."
    );
    const baseUrl = `http://127.0.0.1:${address.port}`;

    log(`API listening on ${baseUrl}`);

    const readiness = await request(baseUrl, "GET", "/readiness");
    assert(readiness.status === 200, `GET /readiness returned ${readiness.status}`);
    assertPostgresRuntimeReady(readiness.body.checks as JsonObject[]);
    log("readiness reports active Postgres state and queue backends");

    const repositoryResponse = await request(baseUrl, "POST", "/repositories", {
      name: "Postgres smoke repository",
      path: repositoryPath,
      defaultBranch: "main",
      qualityGates: []
    });
    assert(
      repositoryResponse.status === 201,
      `POST /repositories returned ${repositoryResponse.status}`
    );
    createdIds.repositoryId = repositoryResponse.body.id as string;
    const repositoryRow = await prisma.repositoryRecord.findUnique({
      where: {
        id: createdIds.repositoryId
      }
    });
    assert(repositoryRow, "Registered repository was not persisted to Postgres.");
    log(`registered repository ${createdIds.repositoryId} in Postgres`);

    const workflowResponse = await request(baseUrl, "POST", "/workflows/repository", {
      goal: "Postgres state backend smoke workflow",
      repositoryId: createdIds.repositoryId,
      tasks: [
        {
          id: "postgres-task",
          title: "Write Postgres smoke patch",
          agent: "shell",
          command: `${node} -e "require('fs').appendFileSync('README.md', 'postgres smoke\\\\n')"`
        }
      ],
      qualityGates: [
        {
          id: "postgres-gate",
          title: "Verify Postgres smoke patch",
          command: `${node} -e "const text=require('fs').readFileSync('README.md','utf8'); if(!text.includes('postgres smoke')) process.exit(1)"`
        }
      ]
    });
    assert(
      workflowResponse.status === 201,
      `POST /workflows/repository returned ${workflowResponse.status}`
    );
    createdIds.workflowId = workflowResponse.body.id as string;

    const workflowRow = await prisma.workflowRun.findUnique({
      where: {
        id: createdIds.workflowId
      }
    });
    assert(workflowRow, "Created workflow was not persisted to Postgres.");
    log(`created workflow ${createdIds.workflowId} in Postgres`);

    const enqueueResponse = await request(
      baseUrl,
      "POST",
      `/workflows/${createdIds.workflowId}/enqueue`
    );
    assert(
      enqueueResponse.status === 202,
      `POST /workflows/${createdIds.workflowId}/enqueue returned ${enqueueResponse.status}`
    );
    const jobId = enqueueResponse.body.id as string;
    const queuedJobRow = await prisma.workflowJob.findUnique({
      where: {
        id: jobId
      }
    });
    assert(queuedJobRow?.status === "queued", "Queued job was not persisted to Postgres.");
    log(`queued job ${jobId} in Postgres`);

    const worker = createPostgresSmokeWorker(smokeRoot);
    const workerResult = await worker.runOnce();
    assert(
      workerResult.status === "completed",
      `Postgres worker returned ${workerResult.status}.`
    );
    log(`Postgres worker completed job ${jobId}`);

    const settledJob = await waitForJob(baseUrl, jobId);
    assert(settledJob.status === "completed", `Postgres smoke job ended as ${settledJob.status}`);

    const jobRow = await prisma.workflowJob.findUnique({
      where: {
        id: jobId
      }
    });
    assert(jobRow?.status === "completed", "Completed job was not persisted to Postgres.");

    const restoredWorkflow = await request(
      baseUrl,
      "GET",
      `/workflows/${createdIds.workflowId}`
    );
    assert(
      restoredWorkflow.body.status === "needs_review",
      "Workflow did not reach needs_review through the Postgres-backed API."
    );
    log("workflow and job lifecycle persisted through Postgres");

    const reviewResponse = await request(
      baseUrl,
      "POST",
      `/workflows/${createdIds.workflowId}/review`,
      {
        decision: "approve",
        note: "Postgres smoke approved"
      }
    );
    assert(
      reviewResponse.status === 200,
      `POST /workflows/${createdIds.workflowId}/review returned ${reviewResponse.status}`
    );
    log("review approval completed the Postgres-backed workflow");
  } finally {
    await app.close();
    await cleanupDatabase(createdIds);
    await prisma.$disconnect();
    for (const root of tempRoots.splice(0)) {
      await removeTempRoot(root);
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return (
    process.env.MAWO_POSTGRES_SMOKE_ENTRY === "1" ||
    Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url)
  );
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error("[smoke:api:postgres] failed");
    console.error(error);
    process.exitCode = 1;
  });
}
