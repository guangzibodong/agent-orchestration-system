import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequirementSummary } from "./delivery-console-model";
import type { ArtifactDrawerLink } from "./artifact-drawer";
import { RequirementDetailShell } from "./requirement-detail-shell";

const requirement: RequirementSummary = {
  id: "workflow-review",
  title: "Harden auth checks",
  repositoryLabel: "C:/work/api",
  repositorySafety: {
    repositoryLabel: "C:/work/api",
    executionModeLabel: "Isolated worktree",
    branchLabel: "mawo/workflow-review/task-1",
    headLabel: "abc1234",
    cleanStateLabel: "Apply clean check required",
    allowedRootLabel: "Allowed root accepted by API",
    mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
    recoveryAction: "Run repository preflight before mutating actions"
  },
  requirementStage: "needs_review",
  executionStatus: "needs_review",
  riskLevel: "medium",
  nextAction: "Review merge candidate",
  nodeLabel: "2 tasks / 2 gates",
  updatedAt: "2026-06-06T10:10:00.000Z",
  workflowRunHref: "/workflows/workflow-review",
  workflowRunId: "workflow-review",
  workflowRunStatus: "needs_review",
  workflowRunStatusLabel: "Needs review",
  reviewEvidence: {
    evidenceSourceWorkflowId: "workflow-review",
    changedFiles: ["apps/web/src/app/page.tsx"],
    patchArtifactPaths: [
      "C:/mawo/artifacts/workflow-review/merge-candidate.patch"
    ],
    gateResults: [
      {
        id: "gate-1",
        title: "Unit tests",
        status: "passed",
        command: "npm test",
        required: true,
        exitCode: 0
      }
    ],
    mergeCandidate: {
      status: "ready",
      summary: "Merge candidate ready with 1 changed file",
      sourceBranches: ["mawo/workflow-review/task-1"],
      patchArtifactPath:
        "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
      applyCommand:
        'git -C "C:/work/api" apply "C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
      createdAt: "2026-06-06T11:06:00.000Z"
    }
  },
  availableActions: []
};

const artifacts: ArtifactDrawerLink[] = [
  {
    id: "stdout-1",
    kind: "stdout",
    label: "Task stdout",
    href: "/workflows/workflow-review/artifact?path=stdout.log",
    meta: "12 KB"
  },
  {
    id: "patch-1",
    kind: "patch",
    label: "Merge candidate patch",
    href: "/workflows/workflow-review/artifact?path=merge-candidate.patch",
    meta: "ready",
    path: "C:/mawo/artifacts/workflow-review/merge-candidate.patch"
  },
  {
    id: "report-1",
    kind: "report",
    label: "Delivery report",
    href: "/requirements/workflow-review/report",
    meta: "review evidence"
  },
  {
    id: "audit-1",
    kind: "audit",
    label: "Audit trail",
    href: "/requirements/workflow-review/audit",
    rawContent: "RAW_AUDIT_STREAM_SHOULD_NOT_RENDER"
  } as ArtifactDrawerLink & { rawContent: string }
];

function renderDetail(viewerMode = false): string {
  return renderToStaticMarkup(
    createElement(RequirementDetailShell, {
      requirement,
      artifacts,
      viewerMode,
      onReviewAction: () => undefined
    })
  );
}

const safetyBlockedRequirement: RequirementSummary = {
  ...requirement,
  id: "requirement-dirty",
  title: "Run dirty repo safely",
  repositoryLabel: "C:/work/shop",
  repositorySafety: {
    repositoryLabel: "C:/work/shop",
    executionModeLabel: "Isolated worktree",
    blocksExecution: true,
    statusLabel: "Safety blocked",
    statusTone: "danger",
    branchLabel: "feature/checkout",
    headLabel: "HEAD abc1234",
    cleanStateLabel: "Dirty - mutating runs blocked",
    allowedRootLabel: "Allowed root accepted by API",
    mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
    blockedReason:
      "Repository has uncommitted changes; mutating requirement runs are blocked.",
    recoveryAction:
      "Commit, stash, or discard local changes before running mutating workflows."
  },
  requirementStage: "ready_to_run",
  executionStatus: "ready",
  riskLevel: "high",
  nextAction:
    "Commit, stash, or discard local changes before running mutating workflows.",
  workflowRunId: undefined,
  workflowRunHref: undefined,
  workflowRunStatus: undefined,
  workflowRunStatusLabel: "No workflow run linked",
  reviewEvidence: undefined,
  actionBlockReason:
    "Repository safety blocks execution: Commit, stash, or discard local changes before running mutating workflows.",
  availableActions: []
};

describe("RequirementDetailShell", () => {
  it("renders the frozen requirement detail sections around review evidence", () => {
    const html = renderDetail();

    for (const section of [
      "Overview",
      "Requirement",
      "Plan",
      "Execution",
      "Gates",
      "Review",
      "Value Report",
      "Audit"
    ]) {
      expect(html).toContain(section);
    }

    expect(html).toContain("Harden auth checks");
    expect(html).toContain("Needs Review");
    expect(html).toContain("C:/work/api");
    expect(html).toContain("Isolated worktree");
    expect(html).toContain("No MAWO auto-merge; manual git apply outside MAWO");
    expect(html).toContain("Review merge candidate");
    expect(html).toContain("medium risk");
    expect(html).toContain("2 tasks / 2 gates");
    expect(html).toContain("Quality gates passed");
    expect(html).toContain("Unit tests required passed (exit 0): npm test");
    expect(html).toContain("Merge candidate ready with 1 changed file");
    expect(html).toContain("apps/web/src/app/page.tsx");
    expect(html).toContain(
      "C:/mawo/artifacts/workflow-review/merge-candidate.patch"
    );
    expect(html).not.toContain(
      "Changed file summary appears in report evidence"
    );
    expect(html).not.toContain("Merge candidate ready for manual apply");
    expect(html).not.toContain("RAW_AUDIT_STREAM_SHOULD_NOT_RENDER");
  });

  it("shows an operator review acceptance surface for review-ready work", () => {
    const html = renderDetail();

    expect(html).toContain("Review acceptance");
    expect(html).toContain("Human acceptance decision");
    expect(html).toContain("Ready for approve or reject");
    expect(html).toContain("Manual apply command");
    expect(html).toContain(
      "git -C &quot;C:/work/api&quot; apply &quot;C:/mawo/artifacts/workflow-review/merge-candidate.patch&quot;"
    );
    expect(html).not.toContain(
      "git apply &quot;C:/mawo/artifacts/workflow-review/merge-candidate.patch&quot;"
    );
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });

  it("keeps artifacts discoverable but collapsed inside the detail shell", () => {
    const html = renderDetail();

    expect(html).toContain("Artifacts");
    expect(html).toContain("Task stdout");
    expect(html).toContain("Merge candidate patch");
    expect(html).toContain("Delivery report");
    expect(html).toContain("Audit trail");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
  });

  it("explains retained worktree cleanup policy for review evidence", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDetailShell, {
        requirement: {
          ...requirement,
          workspaceCleanup: {
            statusLabel: "Cleanup blocked until review is recorded",
            summary: "1 tracked worktree, 1 retained for review evidence",
            policy:
              "Retain isolated worktrees while review evidence is pending; cleanup is available after delivery, abort, or archive.",
            rows: [
              {
                task: "Update auth guard",
                branch: "mawo/workflow-review/task-1",
                path: "C:/mawo/worktrees/workflow-review/task-1",
                status: "Retained",
              },
            ],
          },
        },
        artifacts,
      }),
    );

    expect(html).toContain("Worktree cleanup");
    expect(html).toContain("Cleanup blocked until review is recorded");
    expect(html).toContain("1 tracked worktree, 1 retained for review evidence");
    expect(html).toContain(
      "Retain isolated worktrees while review evidence is pending; cleanup is available after delivery, abort, or archive.",
    );
    expect(html).toContain("Update auth guard");
    expect(html).toContain("mawo/workflow-review/task-1");
    expect(html).toContain("C:/mawo/worktrees/workflow-review/task-1");
    expect(html).toContain("Retained");
    expect(html).not.toContain("Clean Workspaces");
    expect(html).not.toContain("Cleanup now");
  });

  it("renders read-only controls and banner in viewer mode", () => {
    const html = renderDetail(true);

    expect(html).toContain("Viewer mode");
    expect(html).toContain("Write actions are disabled");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Retry");
    expect(html).toContain("disabled");
  });

  it("explains repository safety blocked execution inside the detail shell", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDetailShell, {
        requirement: safetyBlockedRequirement,
        artifacts: [],
        onLifecycleAction: () => undefined
      })
    );

    expect(html).toContain("Repository safety blocked");
    expect(html).toContain(
      "Repository safety blocks execution: Commit, stash, or discard local changes before running mutating workflows."
    );
    expect(html).toContain("Dirty - mutating runs blocked");
    expect(html).toContain("Review evidence is pending");
    const enqueueButtons =
      html.match(/<button[^>]*>[\s\S]*?Enqueue<\/button>/g) ?? [];
    expect(enqueueButtons.length).toBeGreaterThan(0);
    expect(enqueueButtons.every((button) => button.includes('disabled=""'))).toBe(
      true
    );
  });

  it("renders an empty shell without requiring a selected requirement", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDetailShell, {
        artifacts: []
      })
    );

    expect(html).toContain("Requirement Detail");
    expect(html).toContain("No requirement selected");
    expect(html).toContain("No artifacts linked yet");
  });
});
