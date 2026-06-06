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
    mergePolicyLabel: "Manual git apply only",
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
      viewerMode
    })
  );
}

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
    expect(html).toContain("Manual git apply only");
    expect(html).toContain("Review merge candidate");
    expect(html).toContain("medium risk");
    expect(html).toContain("2 tasks / 2 gates");
    expect(html).toContain("Quality gates passed");
    expect(html).toContain("Merge candidate ready for manual apply");
    expect(html).not.toContain("RAW_AUDIT_STREAM_SHOULD_NOT_RENDER");
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

  it("renders read-only controls and banner in viewer mode", () => {
    const html = renderDetail(true);

    expect(html).toContain("Viewer mode");
    expect(html).toContain("Write actions are disabled");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Retry");
    expect(html).toContain("disabled");
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
