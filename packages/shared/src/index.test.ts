import { describe, expect, it } from "vitest";
import {
  agentSummarySchema,
  auditEventSchema,
  createRepositoryWorkflowRequestSchema,
  repositoryRegistrationRequestSchema,
  repositoryRecordSchema,
  operationsSnapshotSchema,
  readinessResponseSchema,
  workerHealthResponseSchema,
  mergeCandidateSchema,
  mergeCandidateApplyResultSchema,
  runReportSchema,
  workflowReviewRequestSchema,
  workflowJobSchema,
  workflowRunSchema,
  workspaceCleanupPreviewSchema
} from "./index";

describe("workflowRunSchema", () => {
  it("accepts a valid workflow run", () => {
    expect(
      workflowRunSchema.parse({
        id: "run_1",
        goal: "Build the first orchestrated run",
        status: "running",
        tasks: [
          {
            id: "task_1",
            title: "Plan workflow",
            status: "passed",
            agent: "orchestrator"
          }
        ]
      })
    ).toMatchObject({
      id: "run_1",
      tasks: [{ status: "passed" }]
    });
  });

  it("keeps quality gates and command results from runner responses", () => {
    const run = workflowRunSchema.parse({
      id: "run_2",
      goal: "Run local gates",
      status: "needs_review",
      tasks: [],
      qualityGates: [
        {
          id: "gate_1",
          title: "Unit tests",
          status: "passed",
          required: false,
          result: {
            exitCode: 0,
            stdout: "ok",
            stderr: ""
          }
        }
      ]
    });

    expect(run.qualityGates[0]?.result?.stdout).toBe("ok");
    expect(run.qualityGates[0]?.required).toBe(false);
  });

  it("keeps worktree workspace and diff artifacts from runner responses", () => {
    const run = workflowRunSchema.parse({
      id: "run_3",
      goal: "Run in a worktree",
      status: "needs_review",
      executionMode: "worktree",
      repositoryId: "repo_1",
      repositoryPath: "C:/repo",
      tasks: [
        {
          id: "task_1",
          title: "Edit README",
          status: "passed",
          agent: "shell",
          workspace: {
            path: "C:/repo/.mawo/worktrees/task",
            branch: "mawo/run/task",
            repoPath: "C:/repo"
          },
          diff: {
            status: "M README.md",
            patch: "+worktree runner"
          }
        }
      ],
      qualityGates: []
    });

    expect(run.executionMode).toBe("worktree");
    expect(run.repositoryId).toBe("repo_1");
    expect(run.tasks[0]?.workspace?.branch).toBe("mawo/run/task");
    expect(run.tasks[0]?.diff?.patch).toContain("worktree runner");
  });

  it("keeps CLI agent metadata and report agent fields", () => {
    const run = workflowRunSchema.parse({
      id: "run_4",
      goal: "Run a CLI agent",
      status: "needs_review",
      tasks: [
        {
          id: "task_1",
          title: "Agent task",
          status: "passed",
          agent: "fake-agent",
          result: {
            exitCode: 0,
            stdout: "done",
            stderr: "",
            metadata: {
              agentId: "fake-agent",
              agentLabel: "Fake Agent",
              promptFile: "C:/workspace/.mawo-prompts/fake-agent.prompt.js"
            }
          }
        }
      ],
      qualityGates: []
    });

    const report = runReportSchema.parse({
      workflowId: "run_4",
      summary: "1/1 tasks passed; 0/0 gates passed",
      recommendation: "ready_for_review",
      failedTasks: [],
      failedGates: [],
      taskResults: [
        {
          id: "task_1",
          title: "Agent task",
          status: "passed",
          agentId: "fake-agent",
          agentLabel: "Fake Agent",
          promptFile: "C:/workspace/.mawo-prompts/fake-agent.prompt.js",
          exitCode: 0,
          stdout: "done",
          stderr: "",
          durationMs: 1200
        }
      ],
      gateResults: [
        {
          id: "gate_1",
          title: "Unit tests",
          status: "passed",
          durationMs: 300
        }
      ]
    });

    expect(run.tasks[0]?.result?.metadata?.agentId).toBe("fake-agent");
    expect(report.taskResults[0]?.agentLabel).toBe("Fake Agent");
    expect(report.taskResults[0]?.durationMs).toBe(1200);
    expect(report.gateResults[0]?.durationMs).toBe(300);
  });

  it("keeps persisted artifact paths on reports", () => {
    const report = runReportSchema.parse({
      workflowId: "run_5",
      reportArtifactPath: "C:/artifacts/run_5/report.json",
      summary: "1/1 tasks passed; 1/1 gates passed",
      recommendation: "ready_for_review",
      failedTasks: [],
      failedGates: [],
      taskResults: [
        {
          id: "task_1",
          title: "Task",
          status: "passed",
          stdoutArtifactPath: "C:/artifacts/run_5/tasks/task_1/stdout.txt",
          stderrArtifactPath: "C:/artifacts/run_5/tasks/task_1/stderr.txt",
          gitStatusArtifactPath:
            "C:/artifacts/run_5/tasks/task_1/git-status.txt",
          patchArtifactPath: "C:/artifacts/run_5/tasks/task_1/patch.diff"
        }
      ],
      gateResults: [
        {
          id: "gate_1",
          title: "Gate",
          status: "passed",
          required: false,
          stdoutArtifactPath: "C:/artifacts/run_5/gates/gate_1/stdout.txt"
        }
      ]
    });

    expect(report.reportArtifactPath).toContain("report.json");
    expect(report.taskResults[0]?.patchArtifactPath).toContain("patch.diff");
    expect(report.gateResults[0]?.stdoutArtifactPath).toContain("stdout.txt");
    expect(report.gateResults[0]?.required).toBe(false);
  });

  it("accepts queued workflow job responses", () => {
    const job = workflowJobSchema.parse({
      id: "job_1",
      workflowId: "run_1",
      status: "queued",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z"
    });

    expect(job.status).toBe("queued");
  });

  it("accepts canceled workflow job responses", () => {
    const job = workflowJobSchema.parse({
      id: "job_2",
      workflowId: "run_1",
      status: "canceled",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:01.000Z",
      finishedAt: "2026-06-04T00:00:01.000Z"
    });

    expect(job.status).toBe("canceled");
  });

  it("accepts canceled task run responses", () => {
    const run = workflowRunSchema.parse({
      id: "run_canceled",
      goal: "Cancel running task",
      status: "aborted",
      tasks: [
        {
          id: "task_canceled",
          title: "Canceled task",
          status: "canceled",
          agent: "shell",
          result: {
            exitCode: 1,
            stderr: "Command canceled.",
            metadata: {
              canceled: "true"
            }
          }
        }
      ],
      qualityGates: []
    });

    expect(run.tasks[0]?.status).toBe("canceled");
    expect(run.tasks[0]?.result?.metadata?.canceled).toBe("true");
  });

  it("accepts repository workflow creation requests", () => {
    const request = createRepositoryWorkflowRequestSchema.parse({
      goal: "Implement the next feature",
      repositoryPath: "C:/repo",
      tasks: [
        {
          id: "implement",
          title: "Implement feature",
          agent: "shell",
          command: "npm test",
          timeoutMs: 900000
        }
      ],
      qualityGates: [
        {
          id: "tests",
          title: "Unit tests",
          command: "npm test",
          timeoutMs: 300000
        }
      ]
    });

    expect(request.repositoryPath).toBe("C:/repo");
    expect(request.tasks[0]?.agent).toBe("shell");
    expect(request.tasks[0]?.timeoutMs).toBe(900000);
    expect(request.qualityGates[0]?.id).toBe("tests");
    expect(request.qualityGates[0]?.timeoutMs).toBe(300000);
  });

  it("defaults repository workflow quality gates to required and accepts optional gates", () => {
    const request = createRepositoryWorkflowRequestSchema.parse({
      goal: "Implement optional gate support",
      repositoryPath: "C:/repo",
      tasks: [
        {
          id: "implement",
          agent: "shell",
          command: "npm test"
        }
      ],
      qualityGates: [
        {
          id: "optional-lint",
          title: "Optional lint",
          command: "npm run lint",
          required: false
        },
        {
          id: "unit",
          title: "Unit tests",
          command: "npm test"
        }
      ]
    });

    expect(request.qualityGates[0]?.required).toBe(false);
    expect(request.qualityGates[1]?.required).toBe(true);
  });

  it("accepts repository workflow creation requests by registered repository id", () => {
    const request = createRepositoryWorkflowRequestSchema.parse({
      goal: "Run against a registered repository",
      repositoryId: "repo_1",
      tasks: [
        {
          id: "test",
          agent: "shell",
          command: "npm test"
        }
      ]
    });

    expect(request.repositoryId).toBe("repo_1");
    expect(request.repositoryPath).toBeUndefined();
  });

  it("accepts repository registration records and requests", () => {
    const request = repositoryRegistrationRequestSchema.parse({
      name: "Main application",
      path: "C:/repo",
      defaultBranch: "main",
      qualityGates: [
        {
          id: "lint",
          title: "Lint",
          command: "npm run lint",
          timeoutMs: 300000
        }
      ]
    });
    const record = repositoryRecordSchema.parse({
      id: "repo_1",
      name: request.name,
      path: request.path,
      defaultBranch: request.defaultBranch,
      qualityGates: request.qualityGates,
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z"
    });

    expect(record.name).toBe("Main application");
    expect(record.qualityGates[0]?.command).toBe("npm run lint");
  });

  it("accepts public agent summaries", () => {
    const agent = agentSummarySchema.parse({
      id: "codex",
      label: "Codex CLI"
    });

    expect(agent.label).toBe("Codex CLI");
  });

  it("accepts deployment readiness responses with production blockers", () => {
    const readiness = readinessResponseSchema.parse({
      ok: false,
      service: "mawo-api",
      checkedAt: "2026-06-05T19:54:24.148Z",
      deploymentMode: "production",
      protectedByToken: true,
      root: "C:/mawo",
      activeJobs: 2,
      checks: [
        {
          id: "state_store",
          label: "State store",
          ok: true,
          status: "ready"
        },
        {
          id: "production_config",
          label: "Production security config",
          ok: false,
          status: "blocked",
          deploymentMode: "production",
          protectedByToken: true,
          allowedRepositoryRootsConfigured: false,
          missing: ["MAWO_ALLOWED_REPOSITORY_ROOTS"]
        }
      ]
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.deploymentMode).toBe("production");
    expect(readiness.checks[1]?.status).toBe("blocked");
  });

  it("accepts worker health responses", () => {
    const health = workerHealthResponseSchema.parse({
      ok: true,
      checkedAt: "2026-06-06T01:30:05.079Z",
      staleAfterMs: 60000,
      summary: {
        totalWorkers: 2,
        healthyWorkers: 1,
        staleWorkers: 1
      },
      workers: [
        {
          workerId: "worker-a",
          healthy: true,
          status: "running",
          lastSeenAt: "2026-06-06T01:30:00.000Z",
          ageMs: 5079,
          workflowId: "workflow-1",
          jobId: "job-1"
        },
        {
          workerId: "worker-b",
          healthy: false,
          status: "idle",
          lastSeenAt: "2026-06-06T01:20:00.000Z",
          ageMs: 605079,
          lastJobStatus: "completed"
        }
      ]
    });

    expect(health.summary.healthyWorkers).toBe(1);
    expect(health.workers[0]?.jobId).toBe("job-1");
    expect(health.workers[1]?.lastJobStatus).toBe("completed");
  });

  it("accepts operations snapshot responses", () => {
    const snapshot = operationsSnapshotSchema.parse({
      checkedAt: "2026-06-06T03:07:06.983Z",
      repositoryId: "repo-1",
      summary: {
        queuedJobs: 1,
        runningJobs: 1,
        activeJobs: 2,
        failedJobs: 1,
        needsReviewWorkflows: 1,
        blockedReadinessChecks: 0,
        healthyWorkers: 1,
        totalWorkers: 2
      },
      auditEvents: [
        {
          id: "audit-1",
          type: "workflow.enqueued",
          createdAt: "2026-06-06T03:07:00.000Z",
          actor: "operator",
          workflowId: "workflow-1"
        }
      ],
      jobs: [
        {
          id: "job-1",
          workflowId: "workflow-1",
          status: "queued",
          createdAt: "2026-06-06T03:07:00.000Z",
          updatedAt: "2026-06-06T03:07:00.000Z"
        }
      ],
      readiness: {
        ok: true,
        service: "mawo-api",
        checkedAt: "2026-06-06T03:07:06.983Z",
        deploymentMode: "production",
        protectedByToken: true,
        root: "C:/mawo",
        activeJobs: 2,
        checks: []
      },
      workerHealth: {
        ok: false,
        checkedAt: "2026-06-06T03:07:06.983Z",
        staleAfterMs: 60000,
        summary: {
          totalWorkers: 2,
          healthyWorkers: 1,
          staleWorkers: 1
        },
        workers: [
          {
            workerId: "worker-a",
            healthy: true,
            status: "running",
            lastSeenAt: "2026-06-06T03:07:00.000Z",
            ageMs: 6983
          }
        ]
      }
    });

    expect(snapshot.summary.activeJobs).toBe(2);
    expect(snapshot.repositoryId).toBe("repo-1");
    expect(snapshot.workerHealth.summary.staleWorkers).toBe(1);
  });

  it("accepts workflow review decisions", () => {
    const review = workflowReviewRequestSchema.parse({
      decision: "approve",
      note: "Patch is ready"
    });

    expect(review.decision).toBe("approve");
  });

  it("accepts merge candidate artifacts", () => {
    const candidate = mergeCandidateSchema.parse({
      workflowId: "run_6",
      status: "ready",
      summary: "1 task patch ready to apply",
      sourceBranches: ["mawo/run/task"],
      patch: "diff --git a/README.md b/README.md",
      patchArtifactPath: "C:/artifacts/run_6/merge-candidate.patch",
      manifestArtifactPath: "C:/artifacts/run_6/merge-candidate.json",
      applyCommand:
        'git -C "C:/repo" apply "C:/artifacts/run_6/merge-candidate.patch"',
      createdAt: "2026-06-04T00:00:00.000Z"
    });

    expect(candidate.status).toBe("ready");
    expect(candidate.sourceBranches[0]).toBe("mawo/run/task");
  });

  it("accepts merge candidate apply results", () => {
    const result = mergeCandidateApplyResultSchema.parse({
      workflowId: "run_6",
      status: "applied",
      repositoryPath: "C:/repo",
      sourceBranches: ["mawo/run/task"],
      patchArtifactPath: "C:/artifacts/run_6/merge-candidate.patch",
      gitStatus: " M README.md\n",
      appliedAt: "2026-06-06T02:33:06.171Z"
    });

    expect(result.status).toBe("applied");
    expect(result.gitStatus).toContain("README.md");
  });

  it("accepts workspace cleanup preview responses", () => {
    const preview = workspaceCleanupPreviewSchema.parse({
      workflowId: "run_7",
      workflowStatus: "completed",
      cleanupAllowed: true,
      workspaceCount: 1,
      existingCount: 1,
      workspaces: [
        {
          taskId: "task_1",
          taskTitle: "Edit README",
          path: "C:/repo/.mawo/worktrees/task",
          branch: "mawo/run/task",
          repoPath: "C:/repo",
          exists: true,
          cleanupAllowed: true
        }
      ]
    });

    expect(preview.cleanupAllowed).toBe(true);
    expect(preview.workspaces[0]?.exists).toBe(true);
  });

  it("accepts workflow audit events", () => {
    const event = auditEventSchema.parse({
      id: "audit_1",
      type: "workflow.merge_candidate_applied",
      createdAt: "2026-06-05T00:00:00.000Z",
      workflowId: "run_1",
      actor: "operator",
      metadata: {
        status: "applied",
        repositoryPath: "C:/repo"
      }
    });

    expect(event.type).toBe("workflow.merge_candidate_applied");
    expect(event.workflowId).toBe("run_1");
    expect(event.metadata?.repositoryPath).toBe("C:/repo");
  });

  it("accepts worker job lifecycle audit events", () => {
    const event = auditEventSchema.parse({
      id: "audit_worker_1",
      type: "job.claimed",
      createdAt: "2026-06-05T00:00:00.000Z",
      workflowId: "run_1",
      jobId: "job_1",
      actor: "worker",
      metadata: {
        workerId: "worker-a"
      }
    });

    expect(event.type).toBe("job.claimed");
    expect(event.jobId).toBe("job_1");
    expect(event.metadata?.workerId).toBe("worker-a");
  });

  it("accepts worker heartbeat audit events", () => {
    const event = auditEventSchema.parse({
      id: "audit_worker_heartbeat_1",
      type: "worker.heartbeat",
      createdAt: "2026-06-05T00:00:00.000Z",
      actor: "worker",
      metadata: {
        workerId: "worker-a",
        status: "idle",
        lastJobStatus: "completed"
      }
    });

    expect(event.type).toBe("worker.heartbeat");
    expect(event.metadata?.workerId).toBe("worker-a");
    expect(event.metadata?.status).toBe("idle");
  });

  it("accepts repository update audit events", () => {
    const event = auditEventSchema.parse({
      id: "audit_2",
      type: "repository.updated",
      createdAt: "2026-06-05T00:00:00.000Z",
      actor: "operator",
      metadata: {
        repositoryId: "repo_1",
        previousRepositoryName: "Old name",
        repositoryName: "New name"
      }
    });

    expect(event.type).toBe("repository.updated");
    expect(event.metadata?.repositoryName).toBe("New name");
  });

  it("accepts repository deletion audit events", () => {
    const event = auditEventSchema.parse({
      id: "audit_3",
      type: "repository.deleted",
      createdAt: "2026-06-05T00:00:00.000Z",
      actor: "operator",
      metadata: {
        repositoryId: "repo_1",
        repositoryName: "Deleted repo",
        repositoryPath: "C:/repo"
      }
    });

    expect(event.type).toBe("repository.deleted");
    expect(event.metadata?.repositoryPath).toBe("C:/repo");
  });
});
