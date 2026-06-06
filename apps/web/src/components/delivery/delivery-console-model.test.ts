import { describe, expect, it } from "vitest";
import type { RequirementDeliveryTicket, WorkflowRun } from "@mawo/shared";
import {
  buildDeliveryConsoleModel,
  mapRequirementTicketToSummary,
  mapWorkflowToRequirementSummary
} from "./delivery-console-model";

const baseWorkflow: WorkflowRun = {
  id: "workflow-123456789",
  goal: "Fix checkout test flake",
  status: "ready",
  repositoryPath: "C:/work/shop",
  createdAt: "2026-06-06T09:00:00.000Z",
  updatedAt: "2026-06-06T09:05:00.000Z",
  tasks: [
    {
      id: "task-1",
      title: "Patch failing test",
      status: "waiting"
    }
  ],
  qualityGates: [
    {
      id: "gate-1",
      title: "Unit tests",
      status: "waiting",
      required: true
    }
  ]
};

describe("delivery console model", () => {
  it("maps workflow execution state into requirement delivery stages", () => {
    expect(mapWorkflowToRequirementSummary(baseWorkflow)).toEqual({
      id: "workflow-123456789",
      source: "workflow",
      title: "Fix checkout test flake",
      repositoryLabel: "C:/work/shop",
      repositorySafety: {
        allowedRootLabel: "Allowed root pending preflight",
        blockedReason: undefined,
        blocksExecution: false,
        branchLabel: "Branch pending preflight",
        cleanStateLabel: "Clean state pending preflight",
        executionModeLabel: "Direct repository",
        headLabel: "HEAD SHA not reported",
        mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
        recoveryAction: "Run repository preflight before mutating actions",
        repositoryLabel: "C:/work/shop"
      },
      requirementStage: "ready_to_run",
      executionStatus: "ready",
      riskLevel: "medium",
      nextAction: "Run isolated workflow",
      nodeLabel: "1 task / 1 gate",
      updatedAt: "2026-06-06T09:05:00.000Z",
      workflowRunHref: "/workflows/workflow-123456789",
      workflowRunId: "workflow-123456789",
      workflowRunStatus: "ready",
      workflowRunStatusLabel: "Ready",
      taskDefinitions: [
        {
          id: "task-1",
          title: "Patch failing test"
        }
      ],
      qualityGateDefinitions: [
        {
          id: "gate-1",
          title: "Unit tests",
          required: true
        }
      ],
      availableActions: ["enqueue"]
    });

    expect(
      mapWorkflowToRequirementSummary({
        ...baseWorkflow,
        status: "gate_failed"
      })
    ).toMatchObject({
      requirementStage: "needs_rework",
      nextAction: "Retry failed gate",
      riskLevel: "high"
    });

    expect(
      mapWorkflowToRequirementSummary({
        ...baseWorkflow,
        status: "completed",
        review: {
          decision: "approved",
          reviewedAt: "2026-06-06T09:20:00.000Z"
        }
      })
    ).toMatchObject({
      requirementStage: "delivered",
      nextAction: "Review delivered evidence",
      riskLevel: "low"
    });
  });

  it("maps requirement tickets to lifecycle actions and current workflow evidence", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-1",
      title: "Confirm checkout plan",
      repositoryPath: "C:/work/shop",
      goal: "Ship checkout evidence",
      acceptanceCriteria: [
        "Gate evidence is reviewable",
        "Reviewer can see changed files before approval"
      ],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "medium",
      contextPaths: ["apps/web/src/app/page.tsx"],
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          agent: "shell",
          instructions: "Patch checkout"
        }
      ],
      qualityGates: [
        {
          id: "gate-1",
          title: "Unit tests",
          command: "npm test",
          required: true
        }
      ],
      status: "plan_review",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };

    expect(mapRequirementTicketToSummary(requirement)).toMatchObject({
      id: "requirement-1",
      requirementStage: "plan_review",
      nextAction: "Confirm plan",
      repositorySafety: expect.objectContaining({
        allowedRootLabel: "Allowed root pending preflight",
        cleanStateLabel: "Clean state pending preflight"
      }),
      requirementContract: {
        goal: "Ship checkout evidence",
        acceptanceCriteria: [
          "Gate evidence is reviewable",
          "Reviewer can see changed files before approval"
        ],
        constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
        nonGoals: ["Automatic PR creation"],
        contextPaths: ["apps/web/src/app/page.tsx"]
      },
      workflowRunStatusLabel: "No workflow run linked",
      availableActions: ["confirm-plan"]
    });

    expect(
      mapRequirementTicketToSummary(
        {
          ...requirement,
          status: "running",
          currentWorkflowRunId: "workflow-1",
          runLinks: [
            {
              workflowRunId: "workflow-1",
              status: "ready",
              linkedAt: "2026-06-06T11:06:00.000Z"
            }
          ]
        },
        new Map([[baseWorkflow.id, baseWorkflow]]),
        { jobStatusByRequirementId: { "requirement-1": "queued" } }
      )
    ).toMatchObject({
      currentJobStatus: "queued",
      requirementStage: "running",
      workflowRunHref: "/workflows/workflow-1",
      workflowRunId: "workflow-1",
      workflowRunStatus: "ready",
      workflowRunStatusLabel: "Ready"
    });
  });

  it("keeps quality gate definitions available for evidence panels", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-gates",
      title: "Review failed gate evidence",
      repositoryPath: "C:/work/shop",
      goal: "Show gate commands and blocking rules",
      acceptanceCriteria: ["Gate command is visible"],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "high",
      contextPaths: [],
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          agent: "shell",
          instructions: "Patch checkout"
        }
      ],
      qualityGates: [
        {
          id: "gate-unit",
          title: "Unit tests",
          command: "npm test",
          required: true
        },
        {
          id: "gate-format",
          title: "Format check",
          command: "npm run format:check",
          required: false
        },
        {
          command: "npm run smoke:ui",
          required: true
        }
      ],
      status: "needs_rework",
      currentWorkflowRunId: "workflow-gates",
      runLinks: [
        {
          workflowRunId: "workflow-gates",
          status: "gate_failed",
          linkedAt: "2026-06-06T11:10:00.000Z"
        }
      ],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:10:00.000Z"
    };

    expect(mapRequirementTicketToSummary(requirement).qualityGateDefinitions).toEqual([
      {
        id: "gate-unit",
        title: "Unit tests",
        command: "npm test",
        required: true
      },
      {
        id: "gate-format",
        title: "Format check",
        command: "npm run format:check",
        required: false
      },
      {
        id: "gate-3",
        title: "Gate 3",
        command: "npm run smoke:ui",
        required: true
      }
    ]);

    expect(
      mapWorkflowToRequirementSummary({
        ...baseWorkflow,
        qualityGates: [
          {
            id: "gate-smoke",
            title: "Smoke tests",
            command: "npm run smoke:ui",
            status: "failed",
            required: true,
            result: {
              command: "npm run smoke:ui",
              exitCode: 1,
              stderr: "RAW_STDERR_SHOULD_NOT_RENDER"
            }
          }
        ]
      }).qualityGateDefinitions
    ).toEqual([
      {
        id: "gate-smoke",
        title: "Smoke tests",
        command: "npm run smoke:ui",
        required: true
      }
    ]);
  });

  it("preserves the requirement task and gate execution contract for detail views", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-plan-contract",
      title: "Show the confirmed execution plan",
      repositoryPath: "C:/work/shop",
      goal: "Let reviewers inspect the exact frozen execution contract.",
      acceptanceCriteria: ["Task and gate contracts are visible before run."],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic task decomposition"],
      riskLevel: "medium",
      contextPaths: ["apps/web/src/app/page.tsx"],
      tasks: [
        {
          id: "task-contract",
          title: "Patch checkout evidence",
          agent: "shell",
          command: "npm run patch:checkout",
          instructions: "Patch checkout copy and keep evidence reviewable.",
          timeoutMs: 90000,
          dependsOn: ["task-preflight"]
        }
      ],
      qualityGates: [
        {
          id: "gate-unit",
          title: "Unit tests",
          command: "npm test",
          required: true,
          timeoutMs: 120000
        },
        {
          id: "gate-visual",
          title: "Visual smoke",
          command: "npm run smoke:ui",
          required: false,
          timeoutMs: 180000
        }
      ],
      status: "plan_review",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };

    const summary = mapRequirementTicketToSummary(requirement);

    expect(summary.taskDefinitions).toEqual([
      {
        id: "task-contract",
        title: "Patch checkout evidence",
        agent: "shell",
        command: "npm run patch:checkout",
        instructions: "Patch checkout copy and keep evidence reviewable.",
        timeoutMs: 90000,
        dependsOn: ["task-preflight"]
      }
    ]);
    expect(summary.qualityGateDefinitions).toEqual([
      {
        id: "gate-unit",
        title: "Unit tests",
        command: "npm test",
        required: true,
        timeoutMs: 120000
      },
      {
        id: "gate-visual",
        title: "Visual smoke",
        command: "npm run smoke:ui",
        required: false,
        timeoutMs: 180000
      }
    ]);
  });

  it("builds repository safety from real workflow repository and workspace evidence", () => {
    const summary = mapWorkflowToRequirementSummary({
      ...baseWorkflow,
      status: "gate_failed",
      executionMode: "worktree",
      tasks: [
        {
          id: "task-1",
          title: "Patch failing test",
          status: "failed",
          workspace: {
            path: "C:/worktrees/shop/task-1",
            branch: "mawo/workflow-123/task-1",
            repoPath: "C:/work/shop"
          }
        }
      ]
    });

    expect(summary.repositorySafety).toEqual({
      allowedRootLabel: "Allowed root accepted by API",
      blockedReason:
        "Required gate failed; merge approval is blocked while evidence remains inspectable.",
      blocksExecution: false,
      branchLabel: "mawo/workflow-123/task-1",
      cleanStateLabel: "Apply clean check required",
      executionModeLabel: "Isolated worktree",
      headLabel: "HEAD SHA not reported",
      mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
      recoveryAction: "Retry failed gate",
      repositoryLabel: "C:/work/shop"
    });
  });

  it("derives worktree cleanup visibility from linked workflow workspaces", () => {
    const summary = mapWorkflowToRequirementSummary({
      ...baseWorkflow,
      status: "needs_review",
      executionMode: "worktree",
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          status: "passed",
          workspace: {
            path: "C:/worktrees/shop/task-1",
            branch: "mawo/workflow-123/task-1",
            repoPath: "C:/work/shop"
          }
        }
      ]
    });

    expect(summary.workspaceCleanup).toEqual({
      policy:
        "Retain isolated worktrees while review evidence is pending; cleanup is available after delivery, abort, or archive.",
      rows: [
        {
          branch: "mawo/workflow-123/task-1",
          path: "C:/worktrees/shop/task-1",
          status: "Retained",
          task: "Patch checkout"
        }
      ],
      statusLabel: "Cleanup blocked until review is recorded",
      summary: "1 tracked worktree, 1 retained for review evidence"
    });
  });

  it("omits worktree cleanup visibility when no workspace is linked", () => {
    expect(mapWorkflowToRequirementSummary(baseWorkflow).workspaceCleanup).toBeUndefined();
  });

  it("keeps terminal and failed worktree cleanup copy scoped to policy state", () => {
    const worktreeWorkflow: WorkflowRun = {
      ...baseWorkflow,
      executionMode: "worktree",
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          status: "passed",
          workspace: {
            path: "C:/worktrees/shop/task-1",
            branch: "mawo/workflow-123/task-1",
            repoPath: "C:/work/shop"
          }
        }
      ]
    };

    expect(
      mapWorkflowToRequirementSummary({
        ...worktreeWorkflow,
        status: "completed"
      }).workspaceCleanup
    ).toMatchObject({
      statusLabel: "Cleanup ready",
      summary: "1 tracked worktree, 1 ready for cleanup",
      rows: [
        expect.objectContaining({
          status: "Cleanup ready"
        })
      ]
    });

    expect(
      mapWorkflowToRequirementSummary({
        ...worktreeWorkflow,
        status: "gate_failed"
      }).workspaceCleanup
    ).toMatchObject({
      statusLabel: "Cleanup handled by retry",
      summary:
        "1 tracked worktree, retry clears stale worktrees before fresh evidence",
      rows: [
        expect.objectContaining({
          status: "Retry cleanup"
        })
      ]
    });
  });

  it("marks missing repository safety as blocked setup work", () => {
    const summary = mapWorkflowToRequirementSummary({
      ...baseWorkflow,
      repositoryPath: undefined
    });

    expect(summary.repositorySafety).toMatchObject({
      allowedRootLabel: "Allowed root not checked",
      blockedReason: "Repository path required before execution.",
      cleanStateLabel: "No repository selected",
      recoveryAction: "Register or select a repository",
      repositoryLabel: "No repository selected"
    });
  });

  it("maps registered repository safety evidence into blocked user-facing state", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-dirty",
      title: "Run dirty repo safely",
      repositoryId: "repo-dirty",
      repositoryPath: "C:/work/shop",
      goal: "Block execution until the repository is clean",
      acceptanceCriteria: ["Dirty repository is visible before enqueue"],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "high",
      contextPaths: [],
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          agent: "shell",
          instructions: "Patch checkout"
        }
      ],
      qualityGates: [
        {
          id: "gate-1",
          title: "Unit tests",
          command: "npm test",
          required: true
        }
      ],
      status: "ready_to_run",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };

    const dirtySafety = {
      repositoryId: "repo-dirty",
      path: "C:/work/shop",
      defaultBranch: "main",
      currentBranch: "feature/checkout",
      headShortSha: "abc1234",
      clean: false,
      dirty: true,
      allowedRoot: true,
      blockedReason: "repository_dirty",
      recoveryAction:
        "Commit, stash, or discard local changes before running mutating workflows.",
      noAutoMerge: true,
      manualApplyPolicy:
        "Manual review is required; MAWO never automatically merges repository changes."
    } as const;
    const context = {
      repositorySafetyByRepositoryId: {
        "repo-dirty": dirtySafety
      }
    };
    const summary = mapRequirementTicketToSummary(requirement, new Map(), context);

    expect(summary.repositorySafety).toEqual({
      allowedRootLabel: "Allowed root accepted by API",
      blockedReason:
        "Repository has uncommitted changes; mutating requirement runs are blocked.",
      blocksExecution: true,
      branchLabel: "feature/checkout",
      cleanStateLabel: "Dirty - mutating runs blocked",
      executionModeLabel: "Isolated worktree",
      headLabel: "HEAD abc1234",
      mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
      recoveryAction:
        "Commit, stash, or discard local changes before running mutating workflows.",
      repositoryLabel: "C:/work/shop",
      statusLabel: "Safety blocked",
      statusTone: "danger"
    });
    expect(summary).toMatchObject({
      availableActions: [],
      nextAction:
        "Commit, stash, or discard local changes before running mutating workflows."
    });

    expect(
      buildDeliveryConsoleModel(
        [],
        new Date("2026-06-06T11:10:00.000Z"),
        [requirement],
        context
      ).decisionQueue
    ).toEqual([
      {
        actionLabel:
          "Commit, stash, or discard local changes before running mutating workflows.",
        id: "requirement-dirty:repository-safety",
        requirementId: "requirement-dirty",
        severity: "danger",
        title: "Run dirty repo safely"
      }
    ]);
  });

  it("maps disallowed repository roots into blocked safety evidence", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-outside-root",
      title: "Reject outside root",
      repositoryId: "repo-outside",
      repositoryPath: "D:/client/app",
      goal: "Keep runs inside approved roots",
      acceptanceCriteria: ["Outside roots are blocked"],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "high",
      contextPaths: [],
      tasks: [
        {
          id: "task-1",
          title: "Patch copy",
          agent: "shell",
          instructions: "Patch copy"
        }
      ],
      qualityGates: [],
      status: "ready_to_run",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };

    const summary = mapRequirementTicketToSummary(
      requirement,
      new Map(),
      {
        repositorySafetyByRepositoryId: {
          "repo-outside": {
            repositoryId: "repo-outside",
            path: "D:/client/app",
            defaultBranch: "main",
            clean: false,
            dirty: false,
            allowedRoot: false,
            blockedReason: "repository_path_not_allowed",
            recoveryAction:
              "Move the repository under MAWO_ALLOWED_REPOSITORY_ROOTS or update MAWO_ALLOWED_REPOSITORY_ROOTS.",
            noAutoMerge: true,
            manualApplyPolicy:
              "Manual review is required; MAWO never automatically merges repository changes."
          }
        }
      }
    );

    expect(summary.repositorySafety).toMatchObject({
      allowedRootLabel: "Outside allowed roots - blocked",
      blockedReason:
        "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS.",
      branchLabel: "main",
      cleanStateLabel: "Clean state unavailable",
      headLabel: "HEAD SHA not reported",
      recoveryAction:
        "Move the repository under MAWO_ALLOWED_REPOSITORY_ROOTS or update MAWO_ALLOWED_REPOSITORY_ROOTS.",
      statusLabel: "Safety blocked",
      statusTone: "danger"
    });
    expect(summary).toMatchObject({
      availableActions: [],
      nextAction:
        "Move the repository under MAWO_ALLOWED_REPOSITORY_ROOTS or update MAWO_ALLOWED_REPOSITORY_ROOTS."
    });
  });

  it("keeps plan confirmation available when repository safety blocks execution", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-plan-dirty",
      title: "Confirm dirty repo plan",
      repositoryId: "repo-dirty",
      repositoryPath: "C:/work/shop",
      goal: "Confirm the plan before cleaning the repo",
      acceptanceCriteria: ["Plan confirmation stays available"],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "medium",
      contextPaths: [],
      tasks: [
        {
          id: "task-1",
          title: "Patch checkout",
          agent: "shell",
          instructions: "Patch checkout"
        }
      ],
      qualityGates: [],
      status: "plan_review",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };

    const summary = mapRequirementTicketToSummary(
      requirement,
      new Map(),
      {
        repositorySafetyByRepositoryId: {
          "repo-dirty": {
            repositoryId: "repo-dirty",
            path: "C:/work/shop",
            defaultBranch: "main",
            currentBranch: "feature/checkout",
            headShortSha: "abc1234",
            clean: false,
            dirty: true,
            allowedRoot: true,
            blockedReason: "repository_dirty",
            recoveryAction:
              "Commit, stash, or discard local changes before running mutating workflows.",
            noAutoMerge: true,
            manualApplyPolicy:
              "Manual review is required; MAWO never automatically merges repository changes."
          }
        }
      }
    );

    expect(summary).toMatchObject({
      availableActions: ["confirm-plan"],
      nextAction: "Confirm plan"
    });
  });

  it("blocks enqueue and retry when selected CLI agents are unavailable", () => {
    const requirement: RequirementDeliveryTicket = {
      id: "requirement-codex",
      title: "Run Codex safely",
      repositoryPath: "C:/work/shop",
      goal: "Do not enqueue when Codex is missing",
      acceptanceCriteria: ["Codex preflight is visible before enqueue"],
      constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
      nonGoals: ["Automatic PR creation"],
      riskLevel: "high",
      contextPaths: [],
      tasks: [
        {
          id: "patch",
          title: "Patch with Codex",
          agent: "codex",
          instructions: "Patch checkout"
        }
      ],
      qualityGates: [
        {
          id: "gate-1",
          title: "Unit tests",
          command: "npm test",
          required: true
        }
      ],
      status: "ready_to_run",
      runLinks: [],
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:05:00.000Z"
    };
    const context = {
      agentHealth: [
        {
          id: "codex",
          label: "Codex CLI",
          configured: false,
          healthy: false,
          status: "missing_command" as const,
          message:
            "Codex CLI command is not configured. Set MAWO_CODEX_COMMAND_TEMPLATE before enqueue.",
          checkedAt: "2026-06-06T11:00:00.000Z"
        }
      ]
    };

    const summary = mapRequirementTicketToSummary(
      requirement,
      new Map(),
      context
    );
    const model = buildDeliveryConsoleModel(
      [],
      new Date("2026-06-06T11:10:00.000Z"),
      [requirement],
      context
    );

    expect(summary).toMatchObject({
      availableActions: [],
      nextAction: "Configure missing agent",
      actionBlockKind: "agent-availability",
      actionBlockActionLabel: "Configure missing agent",
      actionBlockReason:
        "Agent preflight blocks execution: Codex CLI command is not configured. Set MAWO_CODEX_COMMAND_TEMPLATE before enqueue."
    });
    expect(model.decisionQueue).toEqual([
      {
        actionLabel: "Configure missing agent",
        id: "requirement-codex:agent-availability",
        requirementId: "requirement-codex",
        severity: "danger",
        title: "Run Codex safely"
      }
    ]);

    const planReviewSummary = mapRequirementTicketToSummary(
      {
        ...requirement,
        status: "plan_review"
      },
      new Map(),
      context
    );

    expect(planReviewSummary).toMatchObject({
      availableActions: ["confirm-plan"],
      nextAction: "Confirm plan"
    });
  });

  it("builds KPI and decision queues around user action, not job internals", () => {
    const model = buildDeliveryConsoleModel([
      baseWorkflow,
      {
        ...baseWorkflow,
        id: "workflow-gate-failed",
        goal: "Update billing copy",
        status: "gate_failed",
        updatedAt: "2026-06-06T10:00:00.000Z"
      },
      {
        ...baseWorkflow,
        id: "workflow-review",
        goal: "Harden auth checks",
        status: "needs_review",
        updatedAt: "2026-06-06T10:10:00.000Z"
      }
    ]);

    expect(model.kpis).toEqual({
      activeRequirements: 3,
      needsClarification: 0,
      runningTasks: 0,
      failedGates: 1,
      waitingForReview: 1,
      deliveredLastSevenDays: 0
    });

    expect(model.decisionQueue).toEqual([
      {
        id: "workflow-gate-failed:retry",
        requirementId: "workflow-gate-failed",
        title: "Update billing copy",
        actionLabel: "Retry failed gate",
        severity: "danger"
      },
      {
        id: "workflow-review:review",
        requirementId: "workflow-review",
        title: "Harden auth checks",
        actionLabel: "Review merge candidate",
        severity: "warning"
      }
    ]);
  });

  it("counts only approved deliveries updated inside the last seven days", () => {
    const recentApproved = {
      ...baseWorkflow,
      id: "workflow-recent-approved",
      status: "completed" as const,
      updatedAt: "2026-06-04T09:00:00.000Z",
      review: {
        decision: "approved" as const,
        reviewedAt: "2026-06-04T09:30:00.000Z"
      }
    };
    const oldApproved = {
      ...recentApproved,
      id: "workflow-old-approved",
      updatedAt: "2026-05-20T09:00:00.000Z"
    };
    const recentRejected = {
      ...recentApproved,
      id: "workflow-recent-rejected",
      review: {
        decision: "rejected" as const,
        reviewedAt: "2026-06-04T09:30:00.000Z"
      }
    };

    const model = buildDeliveryConsoleModel(
      [recentApproved, oldApproved, recentRejected],
      new Date("2026-06-06T00:00:00.000Z")
    );

    expect(model.kpis.deliveredLastSevenDays).toBe(1);
  });
});
