import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@mawo/shared";
import { loadRequirementDeliveryModel } from "./requirement-delivery-loader";

describe("requirement delivery loader", () => {
  it("loads workflow runs through the existing workflow API contract", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);
      if (path === "/requirements") {
        return [];
      }

      return [
        {
          id: "workflow-review",
          goal: "Review checkout patch",
          repositoryPath: "C:/work/shop",
          status: "needs_review",
          updatedAt: "2026-06-06T11:05:00.000Z",
          tasks: [{ id: "task-1", title: "Patch checkout", status: "passed" }],
          qualityGates: [
            { id: "gate-1", title: "Unit tests", status: "passed" }
          ]
        }
      ];
    });

    expect(requests).toEqual([
      "/workflows",
      "/requirements",
      "/agents/health",
      "/workflows/workflow-review/report",
      "/workflows/workflow-review/merge-candidate",
      "/audit-events?requirementId=workflow-review&limit=8",
      "/audit-events?workflowId=workflow-review&limit=8"
    ]);
    expect(model.requirements).toHaveLength(1);
    expect(model.requirements[0]).toMatchObject({
      id: "workflow-review",
      title: "Review checkout patch",
      requirementStage: "needs_review",
      nextAction: "Review merge candidate"
    });
    expect(model.decisionQueue[0]).toMatchObject({
      requirementId: "workflow-review",
      actionLabel: "Review merge candidate"
    });
  });

  it("loads agent health so unavailable CLI tasks block enqueue preflight", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);

      if (path === "/workflows") {
        return [];
      }

      if (path === "/agents/health") {
        return [
          {
            id: "codex",
            label: "Codex CLI",
            configured: false,
            healthy: false,
            status: "missing_command",
            message:
              "Codex CLI command is not configured. Set MAWO_CODEX_COMMAND_TEMPLATE before enqueue.",
            checkedAt: "2026-06-06T11:00:00.000Z"
          }
        ];
      }

      return [
        {
          id: "requirement-codex",
          title: "Run Codex ticket",
          repositoryPath: "C:/work/shop",
          goal: "Run checkout evidence through Codex",
          acceptanceCriteria: ["Unavailable agents are visible before enqueue"],
          constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "medium",
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
        }
      ];
    });

    expect(requests).toContain("/agents/health");
    expect(model.requirements[0]).toMatchObject({
      id: "requirement-codex",
      availableActions: [],
      nextAction: "Configure missing agent",
      actionBlockReason:
        "Agent preflight blocks execution: Codex CLI command is not configured. Set MAWO_CODEX_COMMAND_TEMPLATE before enqueue."
    });
    expect(model.decisionQueue).toEqual([
      {
        actionLabel: "Configure missing agent",
        id: "requirement-codex:agent-availability",
        requirementId: "requirement-codex",
        severity: "danger",
        title: "Run Codex ticket"
      }
    ]);
  });

  it("uses requirement tickets as the primary console objects when available", async () => {
    const model = await loadRequirementDeliveryModel(async (path) => {
      if (path === "/workflows") {
        return [
          {
            id: "workflow-linked",
            goal: "Workflow evidence",
            repositoryPath: "C:/work/shop",
            status: "ready",
            updatedAt: "2026-06-06T11:04:00.000Z",
            tasks: [{ id: "task-1", title: "Patch", status: "waiting" }],
            qualityGates: [
              {
                id: "gate-1",
                title: "Unit tests",
                status: "waiting",
                required: true
              }
            ]
          }
        ];
      }

      return [
        {
          id: "requirement-linked",
          title: "Run checkout ticket",
          repositoryPath: "C:/work/shop",
          goal: "Run checkout evidence",
          acceptanceCriteria: ["Evidence is reviewable"],
          constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
          nonGoals: ["Automatic PR creation"],
          riskLevel: "medium",
          contextPaths: [],
          tasks: [
            {
              id: "task-1",
              title: "Patch",
              agent: "shell",
              instructions: "Patch"
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
          currentWorkflowRunId: "workflow-linked",
          runLinks: [
            {
              workflowRunId: "workflow-linked",
              status: "ready",
              linkedAt: "2026-06-06T11:05:00.000Z"
            }
          ],
          createdAt: "2026-06-06T11:00:00.000Z",
          updatedAt: "2026-06-06T11:05:00.000Z"
        }
      ];
    });

    expect(model.requirements).toHaveLength(1);
    expect(model.requirements[0]).toMatchObject({
      id: "requirement-linked",
      nextAction: "Enqueue",
      workflowRunId: "workflow-linked",
      workflowRunStatusLabel: "Ready",
      availableActions: ["enqueue"]
    });
  });

  it("loads registered repository safety for requirement tickets before enqueue", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);

      if (path === "/workflows") {
        return [];
      }

      if (path === "/requirements") {
        return [
          {
            id: "requirement-dirty",
            title: "Run dirty repo safely",
            repositoryId: "repo-dirty",
            repositoryPath: "C:/work/shop",
            goal: "Block execution until repository safety is clear",
            acceptanceCriteria: ["Dirty repository state is visible"],
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
          }
        ];
      }

      if (path === "/repositories/repo-dirty/safety") {
        return {
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
        };
      }

      return [];
    });

    expect(requests).toContain("/repositories/repo-dirty/safety");
    expect(model.requirements[0]?.repositorySafety).toMatchObject({
      statusLabel: "Safety blocked",
      statusTone: "danger",
      branchLabel: "feature/checkout",
      headLabel: "HEAD abc1234",
      cleanStateLabel: "Dirty - mutating runs blocked",
      allowedRootLabel: "Allowed root accepted by API",
      blockedReason:
        "Repository has uncommitted changes; mutating requirement runs are blocked.",
      recoveryAction:
        "Commit, stash, or discard local changes before running mutating workflows."
    });
  });

  it("loads path-only requirement safety before enqueue", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);

      if (path === "/workflows") {
        return [];
      }

      if (path === "/requirements") {
        return [
          {
            id: "requirement-path-dirty",
            title: "Run path-only dirty repo safely",
            repositoryPath: "C:/work/path-only-shop",
            goal: "Block execution until path-only repository safety is clear",
            acceptanceCriteria: ["Dirty repository state is visible"],
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
          }
        ];
      }

      if (path === "/requirements/requirement-path-dirty/safety") {
        return {
          repositoryId: "requirement-path-dirty",
          path: "C:/work/path-only-shop",
          defaultBranch: "main",
          currentBranch: "feature/path-only",
          headShortSha: "def5678",
          clean: false,
          dirty: true,
          allowedRoot: true,
          blockedReason: "repository_dirty",
          recoveryAction:
            "Commit, stash, or discard local changes before running mutating workflows.",
          noAutoMerge: true,
          manualApplyPolicy:
            "Manual review is required; MAWO never automatically merges repository changes."
        };
      }

      return [];
    });

    expect(requests).toContain(
      "/requirements/requirement-path-dirty/safety"
    );
    expect(model.requirements[0]).toMatchObject({
      id: "requirement-path-dirty",
      availableActions: [],
      nextAction:
        "Commit, stash, or discard local changes before running mutating workflows."
    });
    expect(model.requirements[0]?.repositorySafety).toMatchObject({
      statusLabel: "Safety blocked",
      statusTone: "danger",
      branchLabel: "feature/path-only",
      headLabel: "HEAD def5678",
      cleanStateLabel: "Dirty - mutating runs blocked",
      allowedRootLabel: "Allowed root accepted by API",
      blockedReason:
        "Repository has uncommitted changes; mutating requirement runs are blocked."
    });
  });

  it("uses fresh workflow overrides so retry does not show stale failed evidence", async () => {
    const model = await loadRequirementDeliveryModel(
      async (path) => {
        if (path === "/workflows") {
          return [
            {
              id: "workflow-retry",
              goal: "Retry stale gate",
              repositoryPath: "C:/work/shop",
              status: "gate_failed",
              updatedAt: "2026-06-06T11:04:00.000Z",
              tasks: [{ id: "task-1", title: "Patch", status: "failed" }],
              qualityGates: [
                {
                  id: "gate-1",
                  title: "Unit tests",
                  status: "failed",
                  result: { exitCode: 1, stderr: "old failure" }
                }
              ]
            }
          ];
        }

        return [
          {
            id: "requirement-retry",
            title: "Retry stale gate",
            repositoryPath: "C:/work/shop",
            goal: "Retry without stale evidence",
            acceptanceCriteria: ["Retry resets the current evidence"],
            constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
            nonGoals: ["Automatic PR creation"],
            riskLevel: "high",
            contextPaths: [],
            tasks: [
              {
                id: "task-1",
                title: "Patch",
                agent: "shell",
                instructions: "Patch"
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
            currentWorkflowRunId: "workflow-retry",
            runLinks: [
              {
                workflowRunId: "workflow-retry",
                status: "ready",
                linkedAt: "2026-06-06T11:07:00.000Z"
              }
            ],
            createdAt: "2026-06-06T11:00:00.000Z",
            updatedAt: "2026-06-06T11:07:00.000Z"
          }
        ];
      },
      {},
      {
        workflowOverrides: [
          {
            id: "workflow-retry",
            goal: "Retry stale gate",
            repositoryPath: "C:/work/shop",
            status: "ready",
            updatedAt: "2026-06-06T11:07:00.000Z",
            tasks: [{ id: "task-1", title: "Patch", status: "waiting" }],
            qualityGates: [
              {
                id: "gate-1",
                title: "Unit tests",
                status: "waiting",
                required: true
              }
            ]
          }
        ]
      }
    );

    expect(model.requirements[0]).toMatchObject({
      id: "requirement-retry",
      executionStatus: "ready",
      nextAction: "Enqueue",
      requirementStage: "ready_to_run",
      workflowRunStatusLabel: "Ready",
      availableActions: ["enqueue"]
    });
    expect(model.requirements[0]?.artifactLinks).toBeUndefined();
  });

  it("loads report and merge candidate evidence into readable review summary", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);

      if (path === "/workflows") {
        return [
          {
            id: "workflow-linked",
            goal: "Workflow evidence",
            repositoryPath: "C:/work/shop",
            status: "needs_review",
            updatedAt: "2026-06-06T11:04:00.000Z",
            tasks: [{ id: "task-1", title: "Patch", status: "passed" }],
            qualityGates: [
              { id: "gate-1", title: "Unit tests", status: "passed" }
            ]
          }
        ];
      }

      if (path === "/requirements") {
        return [
          {
            id: "requirement-linked",
            title: "Run checkout ticket",
            repositoryPath: "C:/work/shop",
            goal: "Run checkout evidence",
            acceptanceCriteria: ["Evidence is reviewable"],
            constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
            nonGoals: ["Automatic PR creation"],
            riskLevel: "medium",
            contextPaths: [],
            tasks: [
              {
                id: "task-1",
                title: "Patch",
                agent: "shell",
                instructions: "Patch"
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
            status: "needs_review",
            currentWorkflowRunId: "workflow-linked",
            runLinks: [
              {
                workflowRunId: "workflow-linked",
                status: "needs_review",
                linkedAt: "2026-06-06T11:05:00.000Z"
              }
            ],
            createdAt: "2026-06-06T11:00:00.000Z",
            updatedAt: "2026-06-06T11:05:00.000Z"
          }
        ];
      }

      if (path === "/requirements/requirement-linked/report") {
        return {
          workflowId: "workflow-linked",
          reportArtifactPath:
            "C:/mawo/artifacts/workflow-linked/report.json",
          summary: "1/1 tasks passed; 1/1 gates passed",
          recommendation: "ready_for_review",
          failedTasks: [],
          failedGates: [],
          taskResults: [
            {
              id: "task-1",
              title: "Patch checkout",
              status: "passed",
              stdoutArtifactPath:
                "C:/mawo/artifacts/workflow-linked/tasks/task-1/stdout.txt",
              stderrArtifactPath:
                "C:/mawo/artifacts/workflow-linked/tasks/task-1/stderr.txt",
              patchArtifactPath:
                "C:/mawo/artifacts/workflow-linked/tasks/task-1/patch.diff",
              durationMs: 1200
            }
          ],
          gateResults: [
            {
              id: "gate-1",
              title: "Unit tests",
              status: "passed",
              exitCode: 0,
              stdoutArtifactPath:
                "C:/mawo/artifacts/workflow-linked/gates/gate-1/stdout.txt",
              durationMs: 300
            }
          ]
        };
      }

      if (path === "/requirements/requirement-linked/merge-candidate") {
        return {
          workflowId: "workflow-linked",
          status: "ready",
          summary: "Merge candidate ready with 2 changed files",
          sourceBranches: ["mawo/workflow-linked/task-1"],
          patch: [
            "diff --git a/apps/web/src/app/page.tsx b/apps/web/src/app/page.tsx",
            "index 1111111..2222222 100644",
            "--- a/apps/web/src/app/page.tsx",
            "+++ b/apps/web/src/app/page.tsx",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "diff --git a/packages/shared/src/index.ts b/packages/shared/src/index.ts",
            "index 3333333..4444444 100644",
            "--- a/packages/shared/src/index.ts",
            "+++ b/packages/shared/src/index.ts"
          ].join("\n"),
          patchArtifactPath:
            "C:/mawo/artifacts/workflow-linked/merge-candidate.patch",
          manifestArtifactPath:
            "C:/mawo/artifacts/workflow-linked/merge-candidate.json",
          applyCommand:
            'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-linked/merge-candidate.patch"',
          createdAt: "2026-06-06T11:06:00.000Z"
        };
      }

      return [];
    });

    expect(requests).toContain("/requirements/requirement-linked/report");
    expect(requests).toContain(
      "/requirements/requirement-linked/merge-candidate"
    );
    expect(model.requirements[0]?.reviewEvidence).toMatchObject({
      reportSummary: "1/1 tasks passed; 1/1 gates passed",
      totalDurationMs: 1500,
      mergeCandidate: {
        status: "ready",
        summary: "Merge candidate ready with 2 changed files",
        patchArtifactPath:
          "C:/mawo/artifacts/workflow-linked/merge-candidate.patch",
        applyCommand:
          'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-linked/merge-candidate.patch"'
      },
      changedFiles: [
        "apps/web/src/app/page.tsx",
        "packages/shared/src/index.ts"
      ],
      patchArtifactPaths: [
        "C:/mawo/artifacts/workflow-linked/tasks/task-1/patch.diff",
        "C:/mawo/artifacts/workflow-linked/merge-candidate.patch"
      ],
      gateResults: [
        {
          command: "npm test",
          required: true,
          exitCode: 0,
          id: "gate-1",
          status: "passed",
          title: "Unit tests"
        }
      ]
    });
    expect(model.requirements[0]?.artifactLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Freport.json",
          kind: "report",
          label: "Report artifact"
        }),
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Ftasks%2Ftask-1%2Fstdout.txt",
          kind: "stdout",
          label: "Patch checkout stdout"
        }),
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Ftasks%2Ftask-1%2Fstderr.txt",
          kind: "stderr",
          label: "Patch checkout stderr"
        }),
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Ftasks%2Ftask-1%2Fpatch.diff",
          kind: "patch",
          label: "Patch checkout patch"
        }),
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Fgates%2Fgate-1%2Fstdout.txt",
          kind: "stdout",
          label: "Unit tests stdout"
        }),
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Fmerge-candidate.patch",
          kind: "patch",
          label: "Merge candidate patch artifact"
        }),
        expect.objectContaining({
          href:
            "/workflows/workflow-linked/artifact?path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-linked%2Fmerge-candidate.json",
          kind: "report",
          label: "Merge candidate manifest"
        })
      ])
    );
  });

  it("ignores stale review evidence when report and merge candidate belong to a previous workflow", async () => {
    const requests: string[] = [];

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);

      if (path === "/workflows") {
        return [
          {
            id: "workflow-current",
            goal: "Retry checkout ticket",
            repositoryPath: "C:/work/shop",
            status: "needs_review",
            updatedAt: "2026-06-06T11:10:00.000Z",
            tasks: [{ id: "task-1", title: "Patch", status: "passed" }],
            qualityGates: [
              { id: "gate-1", title: "Unit tests", status: "passed" }
            ]
          }
        ];
      }

      if (path === "/requirements") {
        return [
          {
            id: "requirement-retry",
            title: "Retry checkout ticket",
            repositoryPath: "C:/work/shop",
            goal: "Retry without stale evidence",
            acceptanceCriteria: ["Current run owns review evidence"],
            constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
            nonGoals: ["Automatic PR creation"],
            riskLevel: "medium",
            contextPaths: [],
            tasks: [
              {
                id: "task-1",
                title: "Patch",
                agent: "shell",
                instructions: "Patch"
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
            status: "needs_review",
            currentWorkflowRunId: "workflow-current",
            runLinks: [
              {
                workflowRunId: "workflow-stale",
                status: "gate_failed",
                linkedAt: "2026-06-06T11:02:00.000Z"
              },
              {
                workflowRunId: "workflow-current",
                status: "needs_review",
                linkedAt: "2026-06-06T11:10:00.000Z"
              }
            ],
            createdAt: "2026-06-06T11:00:00.000Z",
            updatedAt: "2026-06-06T11:10:00.000Z"
          }
        ];
      }

      if (path === "/requirements/requirement-retry/report") {
        return {
          workflowId: "workflow-stale",
          reportArtifactPath: "C:/mawo/artifacts/workflow-stale/report.json",
          summary: "Stale failed gate report",
          recommendation: "needs_rework",
          failedTasks: [],
          failedGates: ["gate-1"],
          taskResults: [
            {
              id: "task-1",
              title: "Patch",
              status: "failed",
              patchArtifactPath:
                "C:/mawo/artifacts/workflow-stale/tasks/task-1/patch.diff"
            }
          ],
          gateResults: [
            {
              id: "gate-1",
              title: "Unit tests",
              status: "failed",
              exitCode: 1
            }
          ]
        };
      }

      if (path === "/requirements/requirement-retry/merge-candidate") {
        return {
          workflowId: "workflow-stale",
          status: "ready",
          summary: "Stale merge candidate ready",
          sourceBranches: ["mawo/workflow-stale/task-1"],
          patch: [
            "diff --git a/apps/web/src/app/page.tsx b/apps/web/src/app/page.tsx",
            "index 1111111..2222222 100644"
          ].join("\n"),
          patchArtifactPath:
            "C:/mawo/artifacts/workflow-stale/merge-candidate.patch",
          applyCommand:
            'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-stale/merge-candidate.patch"',
          createdAt: "2026-06-06T11:03:00.000Z"
        };
      }

      return [];
    });

    expect(requests).toContain("/requirements/requirement-retry/report");
    expect(requests).toContain(
      "/requirements/requirement-retry/merge-candidate"
    );
    expect(model.requirements[0]).toMatchObject({
      id: "requirement-retry",
      workflowRunId: "workflow-current",
      executionStatus: "needs_review",
      nextAction: "Review merge candidate"
    });
    expect(model.requirements[0]?.reviewEvidence).toBeUndefined();
    expect(model.requirements[0]?.artifactLinks).toBeUndefined();
  });

  it("loads requirement audit trail from requirement and linked workflow events", async () => {
    const requests: string[] = [];
    const requirementAuditEvent: AuditEvent = {
      id: "audit-requirement-created",
      type: "workflow.created",
      actor: "operator",
      workflowId: "workflow-linked",
      createdAt: "2026-06-06T11:00:00.000Z",
      metadata: {
        requirementId: "requirement-linked",
        status: "ready"
      }
    };
    const workflowAuditEvent: AuditEvent = {
      id: "audit-workflow-reviewed",
      type: "workflow.reviewed",
      actor: "operator",
      workflowId: "workflow-linked",
      createdAt: "2026-06-06T11:02:00.000Z",
      metadata: {
        decision: "approved"
      }
    };

    const model = await loadRequirementDeliveryModel(async (path) => {
      requests.push(path);

      if (path === "/workflows") {
        return [
          {
            id: "workflow-linked",
            goal: "Workflow evidence",
            repositoryPath: "C:/work/shop",
            status: "needs_review",
            updatedAt: "2026-06-06T11:04:00.000Z",
            tasks: [{ id: "task-1", title: "Patch", status: "passed" }],
            qualityGates: [
              { id: "gate-1", title: "Unit tests", status: "passed" }
            ]
          }
        ];
      }

      if (path === "/requirements") {
        return [
          {
            id: "requirement-linked",
            title: "Run checkout ticket",
            repositoryPath: "C:/work/shop",
            goal: "Run checkout evidence",
            acceptanceCriteria: ["Evidence is reviewable"],
            constraints: ["No MAWO auto-merge; manual git apply outside MAWO"],
            nonGoals: ["Automatic PR creation"],
            riskLevel: "medium",
            contextPaths: [],
            tasks: [
              {
                id: "task-1",
                title: "Patch",
                agent: "shell",
                instructions: "Patch"
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
            status: "needs_review",
            currentWorkflowRunId: "workflow-linked",
            runLinks: [
              {
                workflowRunId: "workflow-linked",
                status: "needs_review",
                linkedAt: "2026-06-06T11:05:00.000Z"
              }
            ],
            createdAt: "2026-06-06T11:00:00.000Z",
            updatedAt: "2026-06-06T11:05:00.000Z"
          }
        ];
      }

      if (path === "/audit-events?requirementId=requirement-linked&limit=8") {
        return [requirementAuditEvent];
      }

      if (path === "/audit-events?workflowId=workflow-linked&limit=8") {
        return [workflowAuditEvent, requirementAuditEvent];
      }

      return [];
    });

    expect(requests).toContain(
      "/audit-events?requirementId=requirement-linked&limit=8"
    );
    expect(requests).toContain(
      "/audit-events?workflowId=workflow-linked&limit=8"
    );
    expect(model.requirements[0]?.auditTrail).toEqual({
      events: [workflowAuditEvent, requirementAuditEvent]
    });
  });
});
