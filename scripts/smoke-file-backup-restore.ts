import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/api/src/server.js";
import {
  createFileStateBackup,
  readFileStateBackupManifest,
  restoreFileStateBackup,
} from "../apps/api/src/runner/file-backup.js";

type JsonObject = Record<string, unknown>;

const tempRoots: string[] = [];
const smokeMarker = "backup restore smoke marker";

function log(message: string) {
  console.log(`[smoke:backup:restore] ${message}`);
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

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(
          `[smoke:backup:restore] warning: could not remove temp root ${root}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      await delay(250 * (attempt + 1));
    }
  }
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
  authToken = process.env.MAWO_API_TOKEN,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(payload ? { "content-type": "application/json" } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as JsonObject) : {};

  return {
    body,
    status: response.status,
  };
}

async function createCommittedRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "mawo-backup-repo-"));
  tempRoots.push(repoPath);

  runGit(["init", "-b", "main"], repoPath);
  runGit(["config", "user.email", "smoke@example.com"], repoPath);
  runGit(["config", "user.name", "MAWO Backup Smoke"], repoPath);
  await writeFile(join(repoPath, "README.md"), "initial\n", "utf8");
  runGit(["add", "README.md"], repoPath);
  runGit(["commit", "-m", "initial commit"], repoPath);

  return repoPath;
}

async function startApi(demoRoot: string) {
  const app = buildApp(undefined, { demoRoot });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert(
    address && typeof address === "object",
    "API server did not expose a TCP address.",
  );

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function createReviewReadyRepositoryWorkflow(
  baseUrl: string,
  repositoryPath: string,
) {
  const node = JSON.stringify(process.execPath);
  const taskCommand = `${node} -e "require('fs').appendFileSync('README.md','${smokeMarker}\\n');"`;
  const gateCommand = `${node} -e "const fs=require('fs'); if(!fs.readFileSync('README.md','utf8').includes('${smokeMarker}')) process.exit(7);"`;

  const registeredRepository = await request(baseUrl, "POST", "/repositories", {
    defaultBranch: "main",
    name: "Backup restore smoke repository",
    path: repositoryPath,
    qualityGates: [
      {
        command: gateCommand,
        id: "backup-restore-marker-gate",
        timeoutMs: 30000,
        title: "README includes backup restore marker",
      },
    ],
  });
  assert(
    registeredRepository.status === 201,
    `Repository registration returned ${registeredRepository.status}`,
  );
  assert(
    typeof registeredRepository.body.id === "string",
    "Registered repository did not include an id.",
  );

  const repositoryId = String(registeredRepository.body.id);
  const createdWorkflow = await request(baseUrl, "POST", "/workflows/repository", {
    goal: "Smoke test file backup restore evidence",
    qualityGates: [
      {
        command: gateCommand,
        id: "backup-restore-marker-gate",
        timeoutMs: 30000,
        title: "README includes backup restore marker",
      },
    ],
    repositoryId,
    tasks: [
      {
        agent: "shell",
        command: taskCommand,
        id: "append-backup-restore-marker",
        timeoutMs: 30000,
        title: "Append backup restore marker",
      },
    ],
  });
  assert(
    createdWorkflow.status === 201,
    `Repository workflow creation returned ${createdWorkflow.status}`,
  );
  assert(
    typeof createdWorkflow.body.id === "string",
    "Created workflow did not include an id.",
  );

  const workflowId = String(createdWorkflow.body.id);
  const run = await request(baseUrl, "POST", `/workflows/${workflowId}/run`);
  assert(run.status === 200, `Workflow run returned ${run.status}`);
  assert(
    run.body.status === "needs_review",
    `Workflow run status was ${String(run.body.status)}`,
  );

  return { repositoryId, workflowId };
}

async function assertRestoredEvidence(baseUrl: string, workflowId: string) {
  const workflow = await request(baseUrl, "GET", `/workflows/${workflowId}`);
  assert(workflow.status === 200, `Restored workflow returned ${workflow.status}`);
  assert(
    workflow.body.status === "needs_review",
    `Restored workflow status was ${String(workflow.body.status)}`,
  );

  const readiness = await request(baseUrl, "GET", "/readiness");
  assert(readiness.status === 200, `Readiness returned ${readiness.status}`);
  assert(readiness.body.ok === true, "Readiness did not return ok=true.");
  const readinessChecks = readiness.body.checks as Array<JsonObject>;
  assert(
    readinessChecks.some(
      (check) => check.id === "state_store" && check.ok === true,
    ) &&
      readinessChecks.some(
        (check) => check.id === "artifact_store" && check.ok === true,
      ),
    "Readiness did not confirm restored state and artifact stores.",
  );

  const report = await request(baseUrl, "GET", `/workflows/${workflowId}/report`);
  assert(report.status === 200, `Report returned ${report.status}`);
  assert(
    report.body.recommendation === "ready_for_review",
    "Report was not ready_for_review after restore.",
  );
  assert(
    typeof report.body.reportArtifactPath === "string",
    "Report did not include a persisted artifact path after restore.",
  );

  const reportArtifact = await request(
    baseUrl,
    "GET",
    `/workflows/${workflowId}/artifact?path=${encodeURIComponent(
      String(report.body.reportArtifactPath),
    )}`,
  );
  assert(
    reportArtifact.status === 200,
    `Report artifact returned ${reportArtifact.status}`,
  );
  assert(
    typeof reportArtifact.body.content === "string" &&
      reportArtifact.body.content.includes('"recommendation": "ready_for_review"'),
    "Report artifact content was not restored.",
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
    "Merge candidate was not ready after restore.",
  );
  assert(
    typeof mergeCandidate.body.patch === "string" &&
      mergeCandidate.body.patch.includes(smokeMarker),
    "Merge candidate patch did not include the smoke marker after restore.",
  );
  assert(
    typeof mergeCandidate.body.patchArtifactPath === "string" &&
      typeof mergeCandidate.body.manifestArtifactPath === "string" &&
      typeof mergeCandidate.body.applyCommand === "string",
    "Merge candidate did not include persisted artifact paths and apply command after restore.",
  );

  const patchArtifact = await request(
    baseUrl,
    "GET",
    `/workflows/${workflowId}/artifact?path=${encodeURIComponent(
      String(mergeCandidate.body.patchArtifactPath),
    )}`,
  );
  assert(
    patchArtifact.status === 200,
    `Patch artifact returned ${patchArtifact.status}`,
  );
  assert(
    typeof patchArtifact.body.content === "string" &&
      patchArtifact.body.content.includes(smokeMarker),
    "Patch artifact content was not restored.",
  );

  return {
    mergeCandidatePath: mergeCandidate.body.patchArtifactPath,
    reportPath: report.body.reportArtifactPath,
  };
}

async function main() {
  const smokeRoot = await mkdtemp(join(tmpdir(), "mawo-backup-restore-"));
  tempRoots.push(smokeRoot);
  const repositoryPath = await createCommittedRepo();
  const mawoRoot = join(smokeRoot, ".mawo");
  const backupRoot = join(smokeRoot, ".backups");
  let server: Awaited<ReturnType<typeof startApi>> | undefined;

  try {
    server = await startApi(smokeRoot);
    log(`API listening on ${server.baseUrl}`);

    const health = await request(server.baseUrl, "GET", "/health");
    assert(health.status === 200, `GET /health returned ${health.status}`);
    assert(health.body.ok === true, "GET /health did not return ok=true");

    const { repositoryId, workflowId } =
      await createReviewReadyRepositoryWorkflow(server.baseUrl, repositoryPath);
    const beforeRestoreEvidence = await assertRestoredEvidence(
      server.baseUrl,
      workflowId,
    );
    log("created review-ready workflow with report and merge candidate evidence");

    await server.app.close();
    server = undefined;

    const manifest = await createFileStateBackup({
      backupRoot,
      name: "mawo-file-state-smoke",
      sourceDir: mawoRoot,
    });
    const diskManifest = await readFileStateBackupManifest(manifest.backupPath);
    assert(
      diskManifest.fileCount >= 4 && diskManifest.byteCount > 0,
      "Backup manifest did not include persisted state and artifacts.",
    );
    log(`created backup ${manifest.backupPath}`);

    await rm(mawoRoot, { recursive: true, force: true });
    assert(
      !existsSync(join(mawoRoot, "state", "workflows.json")),
      "State deletion did not remove workflows.json before restore.",
    );
    await mkdir(mawoRoot, { recursive: true });
    await writeFile(
      join(mawoRoot, "corrupted.txt"),
      "this file must not survive restore\n",
      "utf8",
    );

    const restoredManifest = await restoreFileStateBackup({
      backupPath: manifest.backupPath,
      targetDir: mawoRoot,
    });
    assert(
      restoredManifest.backupPath === manifest.backupPath,
      "Restore did not return the backup manifest.",
    );
    assert(
      !existsSync(join(mawoRoot, "corrupted.txt")),
      "Restore did not replace the corrupted target .mawo directory.",
    );
    const restoredWorkflowState = await readFile(
      join(mawoRoot, "state", "workflows.json"),
      "utf8",
    );
    assert(
      restoredWorkflowState.includes(workflowId),
      "Restored workflow state did not include the smoke workflow.",
    );
    log("restored .mawo state from backup");

    server = await startApi(smokeRoot);
    const afterRestoreEvidence = await assertRestoredEvidence(
      server.baseUrl,
      workflowId,
    );
    log("restarted API and verified restored workflow evidence");

    console.log(
      JSON.stringify(
        {
          afterRestoreEvidence,
          backupPath: manifest.backupPath,
          beforeRestoreEvidence,
          fileCount: manifest.fileCount,
          repositoryId,
          repositoryPath,
          restoredWorkflowId: workflowId,
        },
        null,
        2,
      ),
    );
  } finally {
    if (server) {
      await server.app.close();
    }

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
  console.error("[smoke:backup:restore] failed");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
