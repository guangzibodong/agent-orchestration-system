import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/api/src/server.js";

type JsonObject = Record<string, unknown>;

const tempRoots: string[] = [];

function log(message: string) {
  console.log(`[smoke:api] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runGit(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  payload?: JsonObject,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as JsonObject) : {};

  return {
    status: response.status,
    body,
  };
}

async function createCommittedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-smoke-repo-"));
  tempRoots.push(repoPath);

  runGit(["init", "-b", "main"], repoPath);
  runGit(["config", "user.email", "smoke@example.com"], repoPath);
  runGit(["config", "user.name", "MAWO Smoke"], repoPath);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  runGit(["add", "README.md"], repoPath);
  runGit(["commit", "-m", "initial commit"], repoPath);

  return repoPath;
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(
          `[smoke:api] warning: could not remove temp root ${root}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      await delay(250 * (attempt + 1));
    }
  }
}

async function main() {
  const smokeRoot = await mkdtemp(join(tmpdir(), "mawo-smoke-api-"));
  tempRoots.push(smokeRoot);
  const repositoryPath = await createCommittedRepo();
  const counterPath = join(smokeRoot, "attempts.txt").replace(/\\/g, "/");
  const node = JSON.stringify(process.execPath);
  const app = buildApp(undefined, { demoRoot: smokeRoot });

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert(
      address && typeof address === "object",
      "API server did not expose a TCP address.",
    );
    const baseUrl = `http://127.0.0.1:${address.port}`;

    log(`API listening on ${baseUrl}`);

    const health = await request(baseUrl, "GET", "/health");
    assert(health.status === 200, `GET /health returned ${health.status}`);
    assert(health.body.ok === true, "GET /health did not return ok=true");
    log("health endpoint returned ok=true");

    const taskCommand = [
      `${node} -e "`,
      "const fs=require('fs');",
      `const p='${counterPath}';`,
      "const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8'))+1:1;",
      "fs.writeFileSync(p,String(n));",
      "console.log('attempt '+n);",
      "if(n<2) process.exit(7);",
      "fs.appendFileSync('README.md','smoke retry success\\n');",
      '"',
    ].join(" ");
    const gateCommand = `${node} -e "const fs=require('fs'); if(!fs.readFileSync('README.md','utf8').includes('smoke retry success')) process.exit(9);"`;

    const create = await request(baseUrl, "POST", "/workflows/repository", {
      goal: "Smoke test repository workflow retry path",
      repositoryPath,
      tasks: [
        {
          id: "flaky-task",
          title: "Flaky repository task",
          agent: "shell",
          command: taskCommand,
          timeoutMs: 30000,
        },
      ],
      qualityGates: [
        {
          id: "readme-gate",
          title: "README contains smoke marker",
          command: gateCommand,
          timeoutMs: 30000,
        },
      ],
    });
    assert(
      create.status === 201,
      `POST /workflows/repository returned ${create.status}`,
    );
    assert(
      typeof create.body.id === "string",
      "Created workflow did not include an id.",
    );
    assert(
      create.body.status === "ready",
      `Created workflow status was ${String(create.body.status)}`,
    );
    const workflowId = create.body.id;
    log(`created repository workflow ${workflowId}`);

    const failedRun = await request(
      baseUrl,
      "POST",
      `/workflows/${workflowId}/run`,
    );
    assert(failedRun.status === 200, `First run returned ${failedRun.status}`);
    assert(
      failedRun.body.status === "failed",
      `First run status was ${String(failedRun.body.status)}`,
    );
    const failedTasks = failedRun.body.tasks as Array<JsonObject>;
    assert(
      failedTasks[0]?.status === "failed",
      "First task did not fail before retry.",
    );
    log("first run failed as expected");

    const retry = await request(
      baseUrl,
      "POST",
      `/workflows/${workflowId}/retry`,
    );
    assert(retry.status === 200, `Retry returned ${retry.status}`);
    assert(
      retry.body.status === "ready",
      `Retry status was ${String(retry.body.status)}`,
    );
    const retriedTasks = retry.body.tasks as Array<JsonObject>;
    assert(
      retriedTasks[0]?.status === "waiting",
      "Retry did not reset task status to waiting.",
    );
    log("retry reset workflow to ready");

    const passedRun = await request(
      baseUrl,
      "POST",
      `/workflows/${workflowId}/run`,
    );
    assert(passedRun.status === 200, `Second run returned ${passedRun.status}`);
    assert(
      passedRun.body.status === "needs_review",
      `Second run status was ${String(passedRun.body.status)}`,
    );
    const passedTasks = passedRun.body.tasks as Array<JsonObject>;
    const passedGates = passedRun.body.qualityGates as Array<JsonObject>;
    assert(
      passedTasks[0]?.status === "passed",
      "Task did not pass after retry.",
    );
    assert(
      passedGates[0]?.status === "passed",
      "Quality gate did not pass after retry.",
    );
    const taskDiff = passedTasks[0]?.diff as JsonObject | undefined;
    assert(
      typeof taskDiff?.patch === "string" &&
        taskDiff.patch.includes("+smoke retry success"),
      "Task patch did not include the smoke README marker.",
    );
    log("second run reached needs_review with passing gate and patch artifact");

    const report = await request(
      baseUrl,
      "GET",
      `/workflows/${workflowId}/report`,
    );
    assert(report.status === 200, `Report returned ${report.status}`);
    assert(
      report.body.recommendation === "ready_for_review",
      "Report was not ready_for_review.",
    );

    const mergeCandidate = await request(
      baseUrl,
      "GET",
      `/workflows/${workflowId}/merge-candidate`,
    );
    assert(
      mergeCandidate.status === 200,
      `Merge candidate returned ${mergeCandidate.status}`,
    );
    assert(
      mergeCandidate.body.status === "ready",
      "Merge candidate was not ready.",
    );
    assert(
      typeof mergeCandidate.body.applyCommand === "string" &&
        mergeCandidate.body.applyCommand.includes("git -C"),
      "Merge candidate did not include an apply command.",
    );
    log("report and merge candidate are ready");

    const review = await request(baseUrl, "POST", `/workflows/${workflowId}/review`, {
      decision: "approve",
      note: "Smoke reviewed",
    });
    assert(review.status === 200, `Review returned ${review.status}`);
    assert(
      review.body.status === "completed",
      `Reviewed workflow status was ${String(review.body.status)}`,
    );
    log("review approval completed the workflow");

    const slowMarkerPath = join(smokeRoot, "slow-marker.txt").replace(
      /\\/g,
      "/",
    );
    const slowRun = await request(baseUrl, "POST", "/workflows/repository", {
      goal: "Smoke test job cancellation",
      repositoryPath,
      tasks: [
        {
          id: "slow-task",
          title: "Slow cancel task",
          agent: "shell",
          command: `${node} -e "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'done'), 1200)" ${JSON.stringify(slowMarkerPath)}`,
          timeoutMs: 30000,
        },
      ],
      qualityGates: [],
    });
    assert(
      slowRun.status === 201,
      `Cancel smoke workflow returned ${slowRun.status}`,
    );
    assert(
      typeof slowRun.body.id === "string",
      "Cancel smoke workflow did not include an id.",
    );
    const cancelWorkflowId = slowRun.body.id;
    const queuedJob = await request(
      baseUrl,
      "POST",
      `/workflows/${cancelWorkflowId}/enqueue`,
    );
    assert(queuedJob.status === 202, `Enqueue returned ${queuedJob.status}`);
    assert(
      typeof queuedJob.body.id === "string",
      "Queued job did not include an id.",
    );
    const cancelJobId = queuedJob.body.id;
    const duplicateQueuedJob = await request(
      baseUrl,
      "POST",
      `/workflows/${cancelWorkflowId}/enqueue`,
    );
    assert(
      duplicateQueuedJob.status === 409,
      `Duplicate enqueue returned ${duplicateQueuedJob.status}`,
    );
    assert(
      duplicateQueuedJob.body.error === "workflow_already_running",
      "Duplicate enqueue did not return workflow_already_running.",
    );
    const duplicateActiveJob = duplicateQueuedJob.body.job as
      | JsonObject
      | undefined;
    assert(
      duplicateActiveJob?.id === cancelJobId,
      "Duplicate enqueue did not include the active job.",
    );
    log("duplicate enqueue is rejected while a workflow job is active");

    let runningJob: JsonObject | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const job = await request(baseUrl, "GET", `/jobs/${cancelJobId}`);
      if (job.body.status === "running") {
        runningJob = job.body;
        break;
      }
      await delay(50);
    }
    assert(runningJob, "Cancel smoke job did not reach running state.");

    const duplicateRunningJob = await request(
      baseUrl,
      "POST",
      `/workflows/${cancelWorkflowId}/enqueue`,
    );
    assert(
      duplicateRunningJob.status === 409,
      `Duplicate running enqueue returned ${duplicateRunningJob.status}`,
    );
    assert(
      duplicateRunningJob.body.error === "workflow_already_running",
      "Duplicate running enqueue did not return workflow_already_running.",
    );
    const duplicateRunningActiveJob = duplicateRunningJob.body.job as
      | JsonObject
      | undefined;
    assert(
      duplicateRunningActiveJob?.id === cancelJobId &&
        duplicateRunningActiveJob.status === "running",
      "Duplicate running enqueue did not include the running active job.",
    );
    log("duplicate enqueue is rejected while a workflow job is running");

    const canceledJob = await request(
      baseUrl,
      "POST",
      `/jobs/${cancelJobId}/cancel`,
    );
    assert(
      canceledJob.status === 200,
      `Cancel endpoint returned ${canceledJob.status}`,
    );
    assert(
      canceledJob.body.status === "canceled",
      `Canceled job status was ${String(canceledJob.body.status)}`,
    );
    await delay(1500);
    const settledCanceledJob = await request(
      baseUrl,
      "GET",
      `/jobs/${cancelJobId}`,
    );
    assert(
      settledCanceledJob.body.status === "canceled",
      "Canceled running job was overwritten after runner settled.",
    );
    assert(
      !existsSync(slowMarkerPath),
      "Canceled running job still allowed the slow command to finish.",
    );
    log("running job cancellation aborts the command and remains canceled");

    const auditEvents = await request(baseUrl, "GET", "/audit-events");
    assert(auditEvents.status === 200, `Audit events returned ${auditEvents.status}`);
    const events = auditEvents.body as unknown as Array<JsonObject>;
    const eventTypes = events.map((event) => event.type);
    for (const type of [
      "workflow.created",
      "workflow.retry_requested",
      "workflow.reviewed",
      "workflow.enqueued",
      "job.canceled",
    ]) {
      assert(eventTypes.includes(type), `Audit log did not include ${type}.`);
    }
    assert(
      events.some(
        (event) =>
          event.type === "workflow.reviewed" && event.workflowId === workflowId,
      ),
      "Audit log did not include review event for the main workflow.",
    );
    assert(
      events.some(
        (event) => event.type === "job.canceled" && event.jobId === cancelJobId,
      ),
      "Audit log did not include cancel event for the canceled job.",
    );
    log("audit events recorded create, retry, review, enqueue, and cancel");

    console.log(
      JSON.stringify(
        {
          workflowId,
          repositoryPath,
          report: report.body.summary,
          mergeCandidate: mergeCandidate.body.summary,
          canceledJobId: cancelJobId,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    if (process.env.MAWO_SMOKE_KEEP_TEMP === "1") {
      log(`kept temp roots: ${tempRoots.join(", ")}`);
    } else {
      for (const root of tempRoots.splice(0).reverse()) {
        await removeTempRoot(root);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error("[smoke:api] failed");
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
