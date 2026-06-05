import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./server.js";
import { LocalRunner } from "./runner/local-runner.js";
import { ShellAdapter } from "./runner/shell-adapter.js";

const tempRoots: string[] = [];
const node = JSON.stringify(process.execPath);
const shell = new ShellAdapter();

async function run(command: string, cwd: string) {
  const result = await shell.run({ command, cwd });

  if (result.status !== "passed") {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command}`);
  }

  return result;
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
        MAWO_API_TOKEN: "secret-token"
      }
    });

    const healthResponse = await app.inject({
      method: "GET",
      url: "/health"
    });
    const rejectedResponse = await app.inject({
      method: "GET",
      url: "/workflows"
    });
    const acceptedResponse = await app.inject({
      method: "GET",
      url: "/workflows",
      headers: {
        authorization: "Bearer secret-token"
      }
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(rejectedResponse.statusCode).toBe(401);
    expect(rejectedResponse.json()).toMatchObject({
      error: "unauthorized"
    });
    expect(acceptedResponse.statusCode).toBe(200);
  });

  it("lists configured agents without exposing command templates", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_CODEX_COMMAND_TEMPLATE: "codex run --prompt-file {promptFile}"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/agents"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: "fake-agent", label: "Fake CLI Agent" },
      { id: "codex", label: "Codex CLI" }
    ]);
  });

  it("exposes agent health without exposing command templates", async () => {
    const app = buildApp(undefined, {
      env: {
        MAWO_CODEX_COMMAND_TEMPLATE: "missing-codex-binary run --prompt-file {promptFile}"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/agents/health"
    });
    const health = response.json();

    expect(response.statusCode).toBe(200);
    expect(health).toEqual([
      expect.objectContaining({
        id: "fake-agent",
        healthy: true,
        status: "healthy"
      }),
      expect.objectContaining({
        id: "codex",
        healthy: false,
        status: "missing_command",
        command: "missing-codex-binary"
      })
    ]);
    expect(JSON.stringify(health)).not.toContain("{promptFile}");
  });

  it("creates, runs, and reports a demo workflow", async () => {
    const app = buildApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.status).toBe("ready");
    expect(created.tasks).toHaveLength(3);

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");

    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
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
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.executionMode).toBe("worktree");
    expect(created.repositoryPath).toContain("demo-repo");

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0].workspace.path).toContain("worktrees");
    expect(completed.tasks[0].diff.patch).toContain("+worktree runner");

    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
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
      url: "/workflows/agent-demo"
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.tasks[0].agent).toBe("fake-agent");

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const completed = runResponse.json();

    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");
    expect(completed.tasks[0].result.metadata.agentId).toBe("fake-agent");
    expect(completed.tasks[0].diff.patch).toContain("+cli agent adapter");

    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
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
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });

    const secondApp = buildApp(undefined, { demoRoot });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: `/workflows/${created.id}`
    });
    const reportResponse = await secondApp.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
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
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-workflow-filter-test-"));
    const repoPath = await createCommittedRepo();
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    await app.inject({
      method: "POST",
      url: "/workflows/demo"
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
            command: `${node} -e "console.log('first')"`
          }
        ],
        qualityGates: []
      }
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
            command: `${node} -e "console.log('second')"`
          }
        ],
        qualityGates: []
      }
    });
    const firstRepositoryWorkflow = firstRepositoryWorkflowResponse.json();
    const secondRepositoryWorkflow = secondRepositoryWorkflowResponse.json();

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/workflows?status=ready&repositoryPath=${encodeURIComponent(
        repoPath
      )}&limit=1`
    });
    const invalidStatusResponse = await app.inject({
      method: "GET",
      url: "/workflows?status=not-real"
    });

    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json()).toEqual([
      expect.objectContaining({
        id: secondRepositoryWorkflow.id,
        status: "ready",
        repositoryPath: repoPath
      })
    ]);
    expect(filteredResponse.json()).not.toEqual([
      expect.objectContaining({
        id: firstRepositoryWorkflow.id
      })
    ]);
    expect(invalidStatusResponse.statusCode).toBe(400);
    expect(invalidStatusResponse.json()).toMatchObject({
      error: "invalid_workflow_status"
    });
  });

  it("serves persisted workflow artifacts through a bounded API endpoint", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-artifact-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
    });
    const report = reportResponse.json();

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?path=${encodeURIComponent(
        report.reportArtifactPath
      )}`
    });
    const artifact = artifactResponse.json();

    expect(artifactResponse.statusCode).toBe(200);
    expect(artifact).toMatchObject({
      workflowId: created.id,
      contentType: "text/plain; charset=utf-8",
      truncated: false
    });
    expect(artifact.path).toContain("report.json");
    expect(artifact.sizeBytes).toBeGreaterThan(0);
    expect(artifact.content).toContain('"recommendation": "ready_for_review"');
  });

  it("records audit events when workflow artifacts are read", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-artifact-audit-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
    });
    const report = reportResponse.json();

    await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?maxBytes=128&path=${encodeURIComponent(
        report.reportArtifactPath
      )}`
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?workflowId=${created.id}`
    });
    const artifactRead = auditResponse
      .json()
      .find((event: { type: string }) => event.type === "workflow.artifact_read");

    expect(auditResponse.statusCode).toBe(200);
    expect(artifactRead).toMatchObject({
      type: "workflow.artifact_read",
      actor: "operator",
      workflowId: created.id,
      metadata: {
        artifactPath: report.reportArtifactPath,
        maxBytes: "128",
        truncated: "true"
      }
    });
    expect(Number(artifactRead.metadata.sizeBytes)).toBeGreaterThan(128);
  });

  it("rejects artifact reads outside the workflow artifact directory", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-artifact-guard-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?path=${encodeURIComponent(
        join(demoRoot, ".mawo", "state", "workflows.json")
      )}`
    });

    expect(artifactResponse.statusCode).toBe(403);
    expect(artifactResponse.json()).toMatchObject({
      error: "artifact_path_not_allowed"
    });
  });

  it("returns only the requested artifact prefix for large files", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-artifact-limit-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const reportResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/report`
    });
    const report = reportResponse.json();
    await writeFile(report.reportArtifactPath, "🙂🙂🙂", "utf8");

    const artifactResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/artifact?maxBytes=8&path=${encodeURIComponent(
        report.reportArtifactPath
      )}`
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
      url: "/workflows/demo"
    });
    const demoWorkflow = demoCreateResponse.json();
    const enqueueResponse = await firstApp.inject({
      method: "POST",
      url: `/workflows/${demoWorkflow.id}/enqueue`
    });
    const queuedJob = enqueueResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/jobs/${queuedJob.id}/cancel`
    });

    const reviewCreateResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const reviewWorkflow = reviewCreateResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${reviewWorkflow.id}/run`
    });
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${reviewWorkflow.id}/review`,
      payload: {
        decision: "approve",
        note: "Audit trail ready"
      }
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
            command: `${node} -e "process.exit(7)"`
          }
        ],
        qualityGates: []
      }
    });
    const retryWorkflow = failCreateResponse.json();
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${retryWorkflow.id}/run`
    });
    await firstApp.inject({
      method: "POST",
      url: `/workflows/${retryWorkflow.id}/retry`
    });

    const auditResponse = await firstApp.inject({
      method: "GET",
      url: "/audit-events"
    });
    const events = auditResponse.json();

    expect(auditResponse.statusCode).toBe(200);
    expect(events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining([
        "workflow.created",
        "workflow.enqueued",
        "job.canceled",
        "workflow.reviewed",
        "workflow.retry_requested"
      ])
    );
    expect(
      events.find(
        (event: { type: string; workflowId?: string; jobId?: string }) =>
          event.type === "job.canceled" && event.jobId === queuedJob.id
      )
    ).toMatchObject({
      workflowId: demoWorkflow.id,
      jobId: queuedJob.id
    });

    const secondApp = buildApp(undefined, { demoRoot });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: "/audit-events"
    });
    const restoredEvents = restoredResponse.json();

    expect(restoredResponse.statusCode).toBe(200);
    expect(restoredEvents.map((event: { id: string }) => event.id)).toEqual(
      events.map((event: { id: string }) => event.id)
    );
  });

  it("persists task and gate lifecycle audit events while workflows run", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-runtime-audit-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?workflowId=${created.id}`
    });
    const events = auditResponse.json();

    expect(auditResponse.statusCode).toBe(200);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow.task_started",
          workflowId: created.id,
          metadata: expect.objectContaining({
            taskId: "plan"
          })
        }),
        expect.objectContaining({
          type: "workflow.task_completed",
          workflowId: created.id,
          metadata: expect.objectContaining({
            taskId: "plan",
            status: "passed"
          })
        }),
        expect.objectContaining({
          type: "workflow.gate_started",
          workflowId: created.id,
          metadata: expect.objectContaining({
            gateId: "node"
          })
        }),
        expect.objectContaining({
          type: "workflow.gate_completed",
          workflowId: created.id,
          metadata: expect.objectContaining({
            gateId: "node",
            status: "passed"
          })
        })
      ])
    );
  });

  it("limits audit event history to the most recent events", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-audit-limit-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    await app.inject({ method: "POST", url: "/workflows/demo" });
    await app.inject({ method: "POST", url: "/workflows/worktree-demo" });
    await app.inject({ method: "POST", url: "/workflows/agent-demo" });

    const allResponse = await app.inject({
      method: "GET",
      url: "/audit-events"
    });
    const limitedResponse = await app.inject({
      method: "GET",
      url: "/audit-events?limit=2"
    });
    const events = allResponse.json();
    const limited = limitedResponse.json();

    expect(limitedResponse.statusCode).toBe(200);
    expect(limited.map((event: { id: string }) => event.id)).toEqual(
      events.slice(-2).map((event: { id: string }) => event.id)
    );
  });

  it("filters audit events by type actor job and repository metadata", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-audit-filter-test-"));
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
        qualityGates: []
      }
    });
    const repository = repositoryResponse.json();
    await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Filter repo updated",
        path: repoPath,
        defaultBranch: "main",
        qualityGates: []
      }
    });
    const workflowResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const workflow = workflowResponse.json();
    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${workflow.id}/enqueue`
    });
    const job = enqueueResponse.json();
    await app.inject({
      method: "POST",
      url: `/jobs/${job.id}/cancel`
    });

    const repositoryAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=repository.updated&actor=operator&repositoryId=${repository.id}&limit=1`
    });
    const jobAuditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?type=job.canceled&jobId=${job.id}&actor=operator`
    });
    const invalidTypeResponse = await app.inject({
      method: "GET",
      url: "/audit-events?type=not.real"
    });

    expect(repositoryAuditResponse.statusCode).toBe(200);
    expect(repositoryAuditResponse.json()).toEqual([
      expect.objectContaining({
        type: "repository.updated",
        actor: "operator",
        metadata: expect.objectContaining({
          repositoryId: repository.id,
          repositoryName: "Filter repo updated"
        })
      })
    ]);
    expect(jobAuditResponse.statusCode).toBe(200);
    expect(jobAuditResponse.json()).toEqual([
      expect.objectContaining({
        type: "job.canceled",
        jobId: job.id,
        actor: "operator"
      })
    ]);
    expect(invalidTypeResponse.statusCode).toBe(400);
    expect(invalidTypeResponse.json()).toMatchObject({
      error: "invalid_audit_event_type"
    });
  });

  it("restores completed job history when the API is rebuilt", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-job-persist-test-"));
    tempRoots.push(demoRoot);
    const firstApp = buildApp(undefined, { demoRoot });
    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();

    const enqueueResponse = await firstApp.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`
    });
    const queued = enqueueResponse.json();
    let job = queued;
    for (let attempt = 0; attempt < 20 && job.status !== "completed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const jobResponse = await firstApp.inject({
        method: "GET",
        url: `/jobs/${queued.id}`
      });
      job = jobResponse.json();
    }

    const secondApp = buildApp(undefined, { demoRoot });
    const jobsResponse = await secondApp.inject({
      method: "GET",
      url: "/jobs"
    });
    const restoredJobs = jobsResponse.json();

    expect(job.status).toBe("completed");
    expect(jobsResponse.statusCode).toBe(200);
    expect(restoredJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: queued.id,
          workflowId: created.id,
          status: "completed"
        })
      ])
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
    await app.inject({ method: "POST", url: `/workflows/${second.id}/enqueue` });
    await app.inject({ method: "POST", url: `/workflows/${third.id}/enqueue` });

    const allResponse = await app.inject({ method: "GET", url: "/jobs" });
    const limitedResponse = await app.inject({
      method: "GET",
      url: "/jobs?limit=2"
    });
    const jobs = allResponse.json();
    const limited = limitedResponse.json();

    expect(limitedResponse.statusCode).toBe(200);
    expect(limited.map((job: { id: string }) => job.id)).toEqual(
      jobs.slice(-2).map((job: { id: string }) => job.id)
    );
  });

  it("records audit events for jobs recovered after API restart", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-job-recovery-audit-test-"));
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
            startedAt: "2026-06-05T00:00:01.000Z"
          }
        ],
        null,
        2
      ),
      "utf8"
    );

    const app = buildApp(undefined, { demoRoot });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events"
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
          recoveredStatus: "failed"
        })
      })
    );
  });

  it("registers repositories and restores them across API rebuilds", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-repository-registry-test-"));
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
            command: `${node} -e "const fs = require('fs'); if (!fs.existsSync('README.md')) process.exit(1)"`
          }
        ]
      }
    });
    const created = createResponse.json();
    const secondApp = buildApp(undefined, { demoRoot });
    const listResponse = await secondApp.inject({
      method: "GET",
      url: "/repositories"
    });
    const restored = listResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created).toMatchObject({
      name: "Registered repo",
      path: repoPath,
      defaultBranch: "main"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(restored).toEqual([
      expect.objectContaining({
        id: created.id,
        path: repoPath,
        qualityGates: [
          expect.objectContaining({
            id: "readme"
          })
        ]
      })
    ]);
  });

  it("records an audit event when a repository is registered", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-repository-audit-test-"));
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
            command: "npm test"
          }
        ]
      }
    });
    const created = createResponse.json();
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events"
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
          qualityGates: "1"
        })
      })
    );
  });

  it("updates existing repository registrations for the same normalized path", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-repository-upsert-test-"));
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
        qualityGates: []
      }
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
            command: "npm test"
          }
        ]
      }
    });
    const updated = updateResponse.json();
    const listResponse = await app.inject({
      method: "GET",
      url: "/repositories"
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/audit-events"
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
          command: "npm test"
        })
      ]
    });
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Updated repo",
        path: repoPath
      })
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
          qualityGates: "1"
        })
      })
    );
  });

  it("deletes repository registrations and records an audit event", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-repository-delete-test-"));
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
        qualityGates: []
      }
    });
    const created = createResponse.json();
    const deleteResponse = await firstApp.inject({
      method: "DELETE",
      url: `/repositories/${created.id}`
    });
    const secondDeleteResponse = await firstApp.inject({
      method: "DELETE",
      url: `/repositories/${created.id}`
    });
    const secondApp = buildApp(undefined, { demoRoot });
    const listResponse = await secondApp.inject({
      method: "GET",
      url: "/repositories"
    });
    const auditResponse = await secondApp.inject({
      method: "GET",
      url: "/audit-events"
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      id: created.id,
      name: "Delete me",
      path: repoPath
    });
    expect(secondDeleteResponse.statusCode).toBe(404);
    expect(secondDeleteResponse.json()).toMatchObject({
      error: "repository_not_found"
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
          repositoryPath: repoPath
        })
      })
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
        MAWO_ALLOWED_REPOSITORY_ROOTS: allowedRoot
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/repositories",
      payload: {
        name: "Disallowed repo",
        path: disallowedRepo
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "repository_path_not_allowed"
    });
  });

  it("rejects direct repository workflows outside configured allowed roots", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-workflow-allowlist-test-"));
    const allowedRoot = await mkdtemp(join(tmpdir(), "mawo-api-workflow-allowed-root-"));
    const disallowedRepo = await createCommittedRepo();
    tempRoots.push(demoRoot, allowedRoot);
    const app = buildApp(undefined, {
      demoRoot,
      env: {
        MAWO_ALLOWED_REPOSITORY_ROOTS: allowedRoot
      }
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
            command: `${node} -e "console.log('noop')"`
          }
        ],
        qualityGates: []
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "repository_path_not_allowed"
    });
  });

  it("creates repository workflows from a registered repository id", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-registered-workflow-test-"));
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
            command: `${node} -e "const fs = require('fs'); if (!fs.readFileSync('README.md', 'utf8').includes('registered workflow')) process.exit(1)"`
          }
        ]
      }
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
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'registered workflow\\\\n')"`
          }
        ]
      }
    });
    const created = createResponse.json();
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const completed = runResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.repositoryPath).toBe(repoPath);
    expect(created.qualityGates[0]).toMatchObject({
      id: "readme-gate",
      title: "README has registered marker"
    });
    expect(runResponse.statusCode).toBe(200);
    expect(completed.status).toBe("needs_review");
    expect(completed.qualityGates[0].status).toBe("passed");
  });

  it("enqueues workflow runs and exposes job status", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`
    });
    const queued = enqueueResponse.json();

    expect(enqueueResponse.statusCode).toBe(202);
    expect(queued.status).toBe("queued");
    expect(queued.workflowId).toBe(created.id);

    let job = queued;
    for (let attempt = 0; attempt < 20 && job.status !== "completed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const jobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${queued.id}`
      });
      job = jobResponse.json();
    }

    expect(job.status).toBe("completed");

    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}`
    });
    const workflow = workflowResponse.json();

    expect(workflow.status).toBe("needs_review");
  });

  it("rejects duplicate enqueue requests while a workflow job is active", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();

    const [enqueueResponse, duplicateResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/workflows/${created.id}/enqueue`
      }),
      app.inject({
        method: "POST",
        url: `/workflows/${created.id}/enqueue`
      })
    ]);
    const acceptedResponse =
      enqueueResponse.statusCode === 202 ? enqueueResponse : duplicateResponse;
    const rejectedResponse =
      enqueueResponse.statusCode === 409 ? enqueueResponse : duplicateResponse;
    const queued = acceptedResponse.json();
    const duplicate = rejectedResponse.json();

    await vi.runAllTimersAsync();

    expect([enqueueResponse.statusCode, duplicateResponse.statusCode].sort()).toEqual([
      202,
      409
    ]);
    expect(rejectedResponse.statusCode).toBe(409);
    expect(acceptedResponse.statusCode).toBe(202);
    expect(duplicate).toMatchObject({
      error: "workflow_already_running",
      job: {
        id: queued.id,
        workflowId: created.id,
        status: "queued"
      }
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
          command: `${node} -e "setTimeout(() => console.log('done'), 1200)"`
        }
      ],
      qualityGates: []
    });

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${run.id}/enqueue`
    });
    const queued = enqueueResponse.json();

    let runningJob = queued;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const jobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${queued.id}`
      });
      runningJob = jobResponse.json();
      if (runningJob.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/workflows/${run.id}/enqueue`
    });
    const duplicate = duplicateResponse.json();
    await app.inject({
      method: "POST",
      url: `/jobs/${queued.id}/cancel`
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const workflowResponse = await app.inject({
        method: "GET",
        url: `/workflows/${run.id}`
      });
      if (workflowResponse.json().status === "aborted") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const nextEnqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${run.id}/enqueue`
    });
    const nextJob = nextEnqueueResponse.json();
    await app.inject({
      method: "POST",
      url: `/jobs/${nextJob.id}/cancel`
    });

    expect(enqueueResponse.statusCode).toBe(202);
    expect(runningJob.status).toBe("running");
    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicate).toMatchObject({
      error: "workflow_already_running",
      job: {
        id: queued.id,
        workflowId: run.id,
        status: "running"
      }
    });
    expect(nextEnqueueResponse.statusCode).toBe(202);
    expect(nextJob.id).not.toBe(queued.id);
  });

  it("cancels queued workflow jobs through the jobs API", async () => {
    vi.useFakeTimers();
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();

    const enqueueResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/enqueue`
    });
    const queued = enqueueResponse.json();

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/jobs/${queued.id}/cancel`
    });
    const canceled = cancelResponse.json();

    await vi.runAllTimersAsync();
    const workflowResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}`
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(canceled.status).toBe("canceled");
    expect(workflowResponse.json().status).toBe("ready");
  });

  it("approves a review-ready workflow", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve",
        note: "Looks ready"
      }
    });
    const reviewed = reviewResponse.json();

    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewed.status).toBe("completed");
    expect(reviewed.review).toMatchObject({
      decision: "approved",
      note: "Looks ready"
    });
  });

  it("returns a merge candidate artifact for review-ready worktree workflows", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-merge-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });

    const candidateResponse = await app.inject({
      method: "GET",
      url: `/workflows/${created.id}/merge-candidate`
    });
    const candidate = candidateResponse.json();

    expect(candidateResponse.statusCode).toBe(200);
    expect(candidate.status).toBe("ready");
    expect(candidate.patch).toContain("+worktree runner");
    expect(candidate.patchArtifactPath).toContain("merge-candidate.patch");
    expect(candidate.manifestArtifactPath).toContain("merge-candidate.json");
    expect(candidate.applyCommand).toContain("git -C");
  });

  it("cleans completed workflow workspaces through the API", async () => {
    const demoRoot = await mkdtemp(join(tmpdir(), "mawo-api-cleanup-test-"));
    tempRoots.push(demoRoot);
    const app = buildApp(undefined, { demoRoot });

    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/worktree-demo"
    });
    const created = createResponse.json();
    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const reviewReady = runResponse.json();
    const blockedCleanupResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/workspaces/cleanup`
    });
    await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve",
        note: "Clean it"
      }
    });
    const cleanupResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/workspaces/cleanup`
    });
    const cleanup = cleanupResponse.json();
    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?workflowId=${created.id}`
    });
    const cleanupAuditEvents = auditResponse
      .json()
      .filter(
        (event: { type: string }) => event.type === "workflow.workspaces_cleaned"
      );

    expect(blockedCleanupResponse.statusCode).toBe(409);
    expect(cleanupResponse.statusCode).toBe(200);
    expect(cleanup).toMatchObject({
      workflowId: created.id,
      status: "cleaned",
      cleaned: [
        expect.objectContaining({
          taskId: "worktree-edit",
          path: reviewReady.tasks[0].workspace.path
        })
      ]
    });
    expect(cleanupAuditEvents).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          status: "cleaned",
          cleanedCount: "1",
          cleanedTaskIds: "worktree-edit",
          cleanedBranches: expect.stringContaining("worktree-edit"),
          cleanedPaths: reviewReady.tasks[0].workspace.path
        })
      })
    );
  });

  it("rejects review decisions before a workflow is review-ready", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/workflows/demo"
    });
    const created = createResponse.json();

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/review`,
      payload: {
        decision: "approve"
      }
    });

    expect(reviewResponse.statusCode).toBe(409);
    expect(reviewResponse.json()).toMatchObject({
      error: "workflow_not_review_ready"
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
            command: `${node} -e "const fs = require('fs'); fs.appendFileSync('README.md', 'real repo workflow\\\\n')"`
          }
        ],
        qualityGates: [
          {
            id: "readme",
            title: "README changed",
            command: `${node} -e "const fs = require('fs'); if (!fs.readFileSync('README.md', 'utf8').includes('real repo workflow')) process.exit(1)"`
          }
        ]
      }
    });
    const created = createResponse.json();

    expect(createResponse.statusCode).toBe(201);
    expect(created.executionMode).toBe("worktree");
    expect(created.repositoryPath).toBe(repoPath);
    expect(created.worktreeRoot).toContain("repository-worktrees");

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
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
            timeoutMs: 50
          }
        ],
        qualityGates: []
      }
    });
    const created = createResponse.json();

    const runResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
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
            command: `${node} -e "const fs = require('fs'); const p = '${counterPath}'; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) + 1 : 1; fs.writeFileSync(p, String(n)); console.log('attempt ' + n); if (n < 2) process.exit(7);"`
          }
        ],
        qualityGates: []
      }
    });
    const created = createResponse.json();

    const failedResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
    });
    const failed = failedResponse.json();
    const retryResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/retry`
    });
    const retried = retryResponse.json();
    const rerunResponse = await app.inject({
      method: "POST",
      url: `/workflows/${created.id}/run`
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
            command: `${node} -e "console.log('noop')"`
          }
        ],
        qualityGates: []
      }
    });

    expect(createResponse.statusCode).toBe(422);
    expect(createResponse.json()).toMatchObject({
      error: "repository_not_ready"
    });
  });
});
