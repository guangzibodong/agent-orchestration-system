import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "../apps/api/src/db.js";
import { createConfiguredAgentConfigs } from "../apps/api/src/runner/agent-config.js";
import { FileArtifactStore } from "../apps/api/src/runner/file-artifact-store.js";
import { LocalRunner } from "../apps/api/src/runner/local-runner.js";
import { PostgresWorkflowWorker } from "../apps/api/src/runner/postgres-workflow-worker.js";
import { PrismaAuditStore } from "../apps/api/src/runner/prisma-audit-store.js";
import { PrismaJobStore } from "../apps/api/src/runner/prisma-job-store.js";
import { PrismaRunStore } from "../apps/api/src/runner/prisma-run-store.js";

function log(message: string) {
  console.log(`[worker:postgres] ${message}`);
}

function requireDatabaseUrl(env: Record<string, string | undefined>) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL is required for the Postgres workflow worker. Run migrations first, then retry."
    );
  }
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

export async function main(env: Record<string, string | undefined> = process.env) {
  requireDatabaseUrl(env);

  const root = resolve(env.MAWO_WORKER_ROOT ?? process.cwd());
  const auditStore = new PrismaAuditStore(prisma);
  const runner = new LocalRunner(undefined, {
    cliAgents: createConfiguredAgentConfigs(env),
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
          console.error("[worker:postgres] failed to append runner audit event");
          console.error(error);
        });
    }
  });
  const worker = new PostgresWorkflowWorker({
    runner,
    jobStore: new PrismaJobStore(prisma),
    workerId: env.MAWO_WORKER_ID,
    leaseMs: parsePositiveInteger(env.MAWO_WORKER_LEASE_MS, 5 * 60 * 1000),
    renewIntervalMs: parsePositiveInteger(
      env.MAWO_WORKER_RENEW_INTERVAL_MS,
      60 * 1000
    )
  });
  const pollMs = parsePositiveInteger(env.MAWO_WORKER_POLL_MS, 1_000);
  const runOnce = isTruthy(env.MAWO_WORKER_ONCE);
  let stopping = false;

  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    do {
      const result = await worker.runOnce();
      log(
        result.status === "idle"
          ? "idle"
          : `${result.status} ${result.job.id} for workflow ${result.job.workflowId}`
      );

      if (runOnce) {
        break;
      }

      if (result.status === "idle") {
        await delay(pollMs);
      }
    } while (!stopping);
  } finally {
    await runner.flush();
    await prisma.$disconnect();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return (
    process.env.MAWO_POSTGRES_WORKER_ENTRY === "1" ||
    Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url)
  );
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error("[worker:postgres] failed");
    console.error(error);
    process.exitCode = 1;
  });
}
