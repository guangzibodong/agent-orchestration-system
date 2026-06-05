import { describe, expect, it } from "vitest";
import {
  agentSummarySchema,
  auditEventSchema,
  createRepositoryWorkflowRequestSchema,
  repositoryRegistrationRequestSchema,
  repositoryRecordSchema,
  readinessResponseSchema,
  mergeCandidateSchema,
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
          result: {
            exitCode: 0,
            stdout: "ok",
            stderr: ""
          }
        }
      ]
    });

    expect(run.qualityGates[0]?.result?.stdout).toBe("ok");
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
          stderr: ""
        }
      ],
      gateResults: []
    });

    expect(run.tasks[0]?.result?.metadata?.agentId).toBe("fake-agent");
    expect(report.taskResults[0]?.agentLabel).toBe("Fake Agent");
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
          stdoutArtifactPath: "C:/artifacts/run_5/gates/gate_1/stdout.txt"
        }
      ]
    });

    expect(report.reportArtifactPath).toContain("report.json");
    expect(report.taskResults[0]?.patchArtifactPath).toContain("patch.diff");
    expect(report.gateResults[0]?.stdoutArtifactPath).toContain("stdout.txt");
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
      type: "workflow.workspaces_cleaned",
      createdAt: "2026-06-05T00:00:00.000Z",
      workflowId: "run_1",
      actor: "operator",
      metadata: {
        status: "cleaned",
        cleanedCount: "1"
      }
    });

    expect(event.type).toBe("workflow.workspaces_cleaned");
    expect(event.workflowId).toBe("run_1");
    expect(event.metadata?.cleanedCount).toBe("1");
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
