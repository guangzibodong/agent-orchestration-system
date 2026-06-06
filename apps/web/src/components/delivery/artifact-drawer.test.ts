import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequirementSummary } from "./delivery-console-model";
import {
  ArtifactDrawer,
  buildArtifactDrawerGroups,
  type ArtifactDrawerLink
} from "./artifact-drawer";
import { RequirementEvidencePanel } from "./requirement-evidence-panel";

const artifactLinks: ArtifactDrawerLink[] = [
  {
    id: "stdout-1",
    kind: "stdout",
    label: "Task stdout",
    href: "/workflows/workflow-review/artifact?path=stdout.log",
    meta: "12 KB",
    path: "C:/mawo/artifacts/workflow-review/stdout.log"
  },
  {
    id: "stderr-1",
    kind: "stderr",
    label: "Gate stderr",
    href: "/workflows/workflow-review/artifact?path=stderr.log",
    meta: "3 KB",
    path: "C:/mawo/artifacts/workflow-review/stderr.log"
  },
  {
    id: "patch-1",
    kind: "patch",
    label: "Merge candidate patch",
    href: "/workflows/workflow-review/artifact?path=merge-candidate.patch",
    meta: "ready"
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
    meta: "5 events"
  }
];

const reviewReadyRequirement: RequirementSummary = {
  id: "requirement-auth",
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
  availableActions: []
};

describe("ArtifactDrawer", () => {
  it("groups artifact links in evidence order without rendering raw content", () => {
    expect(buildArtifactDrawerGroups(artifactLinks)).toEqual([
      {
        kind: "stdout",
        title: "stdout",
        links: [artifactLinks[0]]
      },
      {
        kind: "stderr",
        title: "stderr",
        links: [artifactLinks[1]]
      },
      {
        kind: "patch",
        title: "patch",
        links: [artifactLinks[2]]
      },
      {
        kind: "report",
        title: "report",
        links: [artifactLinks[3]]
      },
      {
        kind: "audit",
        title: "audit",
        links: [artifactLinks[4]]
      }
    ]);

    const html = renderToStaticMarkup(
      createElement(ArtifactDrawer, {
        artifacts: [
          ...artifactLinks,
          {
            id: "stdout-raw",
            kind: "stdout",
            label: "Raw stdout link",
            href: "/workflows/workflow-review/artifact?path=raw.log",
            rawContent: "SECRET_RAW_STDOUT_SHOULD_NOT_RENDER"
          } as ArtifactDrawerLink & { rawContent: string }
        ]
      })
    );

    expect(html).toContain("Artifacts");
    expect(html).toContain("6 links");
    expect(html).toContain("Task stdout");
    expect(html).toContain("Gate stderr");
    expect(html).toContain("Merge candidate patch");
    expect(html).toContain("Delivery report");
    expect(html).toContain("Audit trail");
    expect(html).toContain(
      "href=\"/workflows/workflow-review/artifact?path=stdout.log\""
    );
    expect(html).not.toContain("SECRET_RAW_STDOUT_SHOULD_NOT_RENDER");
  });

  it("is collapsed by default so logs do not dominate the first screen", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactDrawer, {
        artifacts: artifactLinks
      })
    );

    expect(html).toContain("<details");
    expect(html).toContain("class=\"artifactDrawer\"");
    expect(html).not.toContain("<details open");
  });

  it("shows a quiet empty state when no artifact links are available", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactDrawer, {
        artifacts: []
      })
    );

    expect(html).toContain("Artifacts");
    expect(html).toContain("No artifacts linked yet");
  });
});

describe("RequirementEvidencePanel artifact links", () => {
  it("surfaces read-only report and merge-candidate links for review-ready evidence", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementEvidencePanel, {
        requirement: reviewReadyRequirement
      })
    );

    expect(html).toContain("Review-ready merge candidate");
    expect(html).toContain("Review ready");
    expect(html).toContain("Read-only evidence links");
    expect(html).toContain("Evidence links");
    expect(html).toContain("3 links");
    expect(html).toContain("Current workflow");
    expect(html).toContain("Requirement report");
    expect(html).toContain("Merge candidate evidence");
    expect(html).toContain("href=\"/workflows/workflow-review\"");
    expect(html).toContain("href=\"/requirements/requirement-auth/report\"");
    expect(html).toContain(
      "href=\"/requirements/requirement-auth/merge-candidate\""
    );
    expect(html).toContain("Patch path and git apply command for reviewer");
    expect(html).toContain("Patch available for human review");
    expect(html).not.toContain("Ready for manual apply");
    expect(html).not.toContain("Apply Candidate");
    expect(html).not.toContain("<button");
  });

  it("uses workflow-scoped evidence links for legacy workflow summaries", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementEvidencePanel, {
        requirement: {
          ...reviewReadyRequirement,
          id: "workflow-review",
          source: "workflow"
        }
      })
    );

    expect(html).toContain("Workflow report");
    expect(html).toContain("href=\"/workflows/workflow-review/report\"");
    expect(html).toContain(
      "href=\"/workflows/workflow-review/merge-candidate\""
    );
    expect(html).not.toContain("href=\"/requirements/workflow-review/report\"");
    expect(html).not.toContain(
      "href=\"/requirements/workflow-review/merge-candidate\""
    );
  });

  it("makes a failed gate visibly blocked without offering a merge-candidate link", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementEvidencePanel, {
        requirement: {
          ...reviewReadyRequirement,
          executionStatus: "gate_failed",
          requirementStage: "needs_rework",
          nextAction: "Retry failed gate",
          repositorySafety: {
            ...reviewReadyRequirement.repositorySafety,
            blockedReason:
              "Required gate failed; merge approval is blocked while evidence remains inspectable."
          },
          workflowRunStatus: "gate_failed",
          workflowRunStatusLabel: "Gate failed"
        }
      })
    );

    expect(html).toContain("Gate blocked by required gate");
    expect(html).toContain("Gate blocked");
    expect(html).toContain(
      "Merge approval is blocked, but evidence remains inspectable for rework."
    );
    expect(html).toContain("Merge approval blocked");
    expect(html).toContain("Merge candidate blocked until required gates pass");
    expect(html).toContain("Requirement report");
    expect(html).not.toContain("Merge candidate evidence");
    expect(html).not.toContain("merge-ready conclusion");
  });
});
