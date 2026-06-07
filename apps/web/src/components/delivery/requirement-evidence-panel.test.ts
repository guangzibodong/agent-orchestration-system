import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RequirementSummary } from "./delivery-console-model";
import {
  RequirementEvidencePanel,
  buildRequirementEvidenceDisplay,
  buildRequirementEvidenceItemPresentation,
} from "./requirement-evidence-panel";

const reviewReadyRequirement: RequirementSummary = {
  id: "requirement-review",
  source: "requirement",
  title: "Review checkout evidence",
  repositoryLabel: "C:/work/shop",
  repositorySafety: {
    repositoryLabel: "C:/work/shop",
    executionModeLabel: "Isolated worktree",
    branchLabel: "mawo/workflow-review/task-1",
    headLabel: "abc1234",
    cleanStateLabel: "Apply clean check required",
    allowedRootLabel: "Allowed root accepted by API",
    mergePolicyLabel: "No MAWO auto-merge; manual git apply outside MAWO",
    recoveryAction: "Run repository preflight before mutating actions",
  },
  requirementStage: "needs_review",
  executionStatus: "needs_review",
  riskLevel: "medium",
  nextAction: "Review merge candidate",
  nodeLabel: "1 task / 1 gate",
  updatedAt: "2026-06-06T11:05:00.000Z",
  workflowRunHref: "/workflows/workflow-review",
  workflowRunId: "workflow-review",
  workflowRunStatus: "needs_review",
  workflowRunStatusLabel: "Needs review",
  availableActions: [],
  reviewEvidence: {
    evidenceSourceWorkflowId: "workflow-review",
    reportSummary: "1/1 tasks passed; 1/1 gates passed",
    reportRecommendation: "ready_for_review",
    changedFiles: [
      "apps/web/src/app/page.tsx",
      "packages/shared/src/index.ts",
    ],
    patchArtifactPaths: [
      "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
    ],
    gateResults: [
      {
        id: "gate-1",
        title: "Unit tests",
        status: "passed",
        command: "npm test",
        required: true,
        exitCode: 0,
      },
      {
        id: "gate-2",
        title: "Visual smoke",
        status: "failed",
        command: "npm run smoke:ui",
        required: false,
        exitCode: 1,
      },
    ],
    mergeCandidate: {
      status: "ready",
      summary: "Merge candidate ready with 2 changed files",
      sourceBranches: ["mawo/workflow-review/task-1"],
      patchArtifactPath:
        "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
      applyCommand:
        'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
      createdAt: "2026-06-06T11:06:00.000Z",
    },
  },
};

describe("RequirementEvidencePanel display model", () => {
  it("keeps unselected and pending evidence states factual", () => {
    const unselected = buildRequirementEvidenceDisplay();
    const pending = buildRequirementEvidenceDisplay({
      ...reviewReadyRequirement,
      executionStatus: "ready",
      requirementStage: "ready_to_run",
      nextAction: "Enqueue requirement",
      reviewEvidence: undefined,
    });

    expect(unselected.summary).toBe("No selected requirement evidence.");
    expect(unselected.summary).not.toContain("Create or select");
    expect(pending.summary).toBe(
      "No review decision evidence is available for the current stage.",
    );
    expect(pending.summary).not.toContain("will appear here");
  });

  it("summarizes review evidence without forcing reviewers into raw artifacts", () => {
    const display = buildRequirementEvidenceDisplay(reviewReadyRequirement);

    expect(display.summary).toBe("Merge candidate ready with 2 changed files");
    expect(display.items).toEqual(
      expect.arrayContaining([
        {
          label: "Delivery report",
          value: "1/1 tasks passed; 1/1 gates passed",
        },
        {
          label: "Changed files",
          value: "apps/web/src/app/page.tsx, packages/shared/src/index.ts",
        },
        {
          label: "Patch artifact",
          value: "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
        },
        {
          label: "Manual apply command",
          value:
            'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
        },
        {
          label: "Decision checkpoint",
          value: "Review decision required; manual apply remains outside MAWO",
        },
        {
          label: "Required gates",
          value: "1 required passed: Unit tests passed (exit 0): npm test",
        },
        {
          label: "Optional gates",
          value:
            "1 optional reported issues: Visual smoke failed (exit 1): npm run smoke:ui; does not block merge approval",
        },
        {
          label: "Evidence source",
          value: "Current workflow workflow-review",
        },
      ]),
    );
    expect(display.items.some((item) => item.value.includes("{"))).toBe(false);
  });

  it("compacts first-screen patch and apply evidence while preserving full values", () => {
    expect(
      buildRequirementEvidenceItemPresentation({
        label: "Patch artifact",
        value: "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
      }),
    ).toEqual({
      visibleValue: ".../workflow-review/merge-candidate.patch",
      fullValue: "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
    });
    expect(
      buildRequirementEvidenceItemPresentation({
        label: "Manual apply command",
        value:
          'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
      }),
    ).toEqual({
      visibleValue:
        'git -C "C:/work/shop" apply ".../workflow-review/merge-candidate.patch"',
      fullValue:
        'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
    });

    const html = renderToStaticMarkup(
      createElement(RequirementEvidencePanel, {
        requirement: reviewReadyRequirement,
      }),
    );

    expect(html).toContain(
      'title="C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
    );
    expect(html).toContain(
      'aria-label="C:/mawo/artifacts/workflow-review/merge-candidate.patch"',
    );
    expect(html).toContain(
      ">.../workflow-review/merge-candidate.patch</dd>",
    );
    expect(html).toContain(
      'title="git -C &quot;C:/work/shop&quot; apply &quot;C:/mawo/artifacts/workflow-review/merge-candidate.patch&quot;"',
    );
    expect(html).toContain(
      ">git -C &quot;C:/work/shop&quot; apply &quot;.../workflow-review/merge-candidate.patch&quot;</dd>",
    );
  });

  it("marks superseded review evidence without exposing stale merge candidates", () => {
    const display = buildRequirementEvidenceDisplay({
      ...reviewReadyRequirement,
      workflowRunHref: "/workflows/workflow-current",
      workflowRunId: "workflow-current",
      workflowRunStatus: "needs_review",
      workflowRunStatusLabel: "Needs review",
      artifactLinks: [
        {
          id: "stale-stdout",
          kind: "stdout",
          label: "Stale retry stdout",
          href: "/workflows/workflow-stale/artifact?path=stdout.log",
          meta: "old failed attempt",
          path: "C:/mawo/artifacts/workflow-stale/stdout.log",
        },
        {
          id: "stale-patch",
          kind: "patch",
          label: "Stale retry patch",
          href: "/workflows/workflow-stale/artifact?path=merge-candidate.patch",
          meta: "old merge candidate",
          path: "C:/mawo/artifacts/workflow-stale/merge-candidate.patch",
        },
        {
          id: "current-stdout",
          kind: "stdout",
          label: "Current retry stdout",
          href: "/workflows/workflow-current/artifact?path=stdout.log",
          meta: "fresh retry attempt",
          path: "C:/mawo/artifacts/workflow-current/stdout.log",
        },
      ],
      reviewEvidence: {
        ...reviewReadyRequirement.reviewEvidence!,
        evidenceSourceWorkflowId: "workflow-stale",
        reportSummary: "Stale merge candidate ready",
        changedFiles: ["apps/web/src/stale-page.tsx"],
        patchArtifactPaths: [
          "C:/mawo/artifacts/workflow-stale/merge-candidate.patch",
        ],
        mergeCandidate: {
          ...reviewReadyRequirement.reviewEvidence!.mergeCandidate!,
          summary: "Stale merge candidate ready",
          patchArtifactPath:
            "C:/mawo/artifacts/workflow-stale/merge-candidate.patch",
          applyCommand:
            'git -C "C:/work/shop" apply "C:/mawo/artifacts/workflow-stale/merge-candidate.patch"',
        },
      },
    });

    expect(display.title).toBe("Superseded review evidence");
    expect(display.statusLabel).toBe("Superseded");
    expect(display.summary).toBe(
      "Superseded evidence from workflow-stale; current workflow workflow-current needs fresh review evidence",
    );
    expect(display.items).toEqual(
      expect.arrayContaining([
        {
          label: "Evidence source",
          value:
            "Superseded evidence from workflow-stale; current workflow workflow-current needs fresh review evidence",
        },
        {
          label: "Merge candidate",
          value:
            "Superseded merge candidate hidden until current workflow reports fresh evidence",
        },
      ]),
    );
    expect(display.items.some((item) => item.label === "Manual apply command")).toBe(
      false,
    );
    expect(display.items.some((item) => item.label === "Patch artifact")).toBe(
      false,
    );
    expect(display.items.some((item) => item.label === "Changed files")).toBe(
      false,
    );
    expect(display.items.some((item) => item.value.includes("workflow-stale/merge-candidate"))).toBe(
      false,
    );
    expect(display.artifactLinks.map((artifact) => artifact.label)).toEqual(
      expect.arrayContaining([
        "Current workflow",
        "Requirement report",
        "Current retry stdout",
      ]),
    );
    expect(display.artifactLinks.map((artifact) => artifact.label)).not.toContain(
      "Merge candidate evidence",
    );
    expect(display.artifactLinks.map((artifact) => artifact.label)).not.toContain(
      "Stale retry stdout",
    );
    expect(display.artifactLinks.map((artifact) => artifact.label)).not.toContain(
      "Stale retry patch",
    );
    expect(display.artifactLinks.some((artifact) =>
      [artifact.href, artifact.path].some((value) => value?.includes("workflow-stale")),
    )).toBe(false);
  });

  it("does not show manual apply commands for failed required gate evidence", () => {
    const display = buildRequirementEvidenceDisplay({
      ...reviewReadyRequirement,
      requirementStage: "needs_rework",
      executionStatus: "gate_failed",
      nextAction: "Retry failed gate",
      workflowRunStatus: "gate_failed",
      workflowRunStatusLabel: "Gate failed",
      reviewEvidence: {
        ...reviewReadyRequirement.reviewEvidence!,
        gateResults: [
          {
            id: "gate-1",
            title: "Unit tests",
            status: "failed",
            command: "npm test",
            required: true,
            exitCode: 1,
          },
        ],
      },
    });

    expect(display.title).toBe("Gate blocked by required gate");
    expect(display.items).toEqual(
      expect.arrayContaining([
        {
          label: "Patch artifact",
          value: "C:/mawo/artifacts/workflow-review/merge-candidate.patch",
        },
        {
          label: "Required gates",
          value:
            "1 required reported issues: Unit tests failed (exit 1): npm test; blocks merge approval",
        },
      ]),
    );
    expect(display.items.some((item) => item.label === "Manual apply command")).toBe(
      false,
    );
    expect(display.items.some((item) => item.value.includes("git -C"))).toBe(
      false,
    );
  });

  it("treats archived requirement evidence as inactive read-only evidence", () => {
    const display = buildRequirementEvidenceDisplay({
      ...reviewReadyRequirement,
      requirementStage: "archived",
      executionStatus: "archived",
      nextAction: "View archived evidence",
      workflowRunStatus: "archived",
      workflowRunStatusLabel: "Archived",
    });

    expect(display.tone).toBe("muted");
    expect(display.title).toBe("Archived evidence");
    expect(display.statusLabel).toBe("Archived");
    expect(display.summary).toBe(
      "Requirement is archived and no longer active; available evidence remains read-only.",
    );
    expect(display.items).toEqual(
      expect.arrayContaining([
        {
          label: "Archive status",
          value: "No longer active",
        },
        {
          label: "Evidence action",
          value: "View archived evidence",
        },
        {
          label: "Last evidence update",
          value: "2026-06-06T11:05:00.000Z",
        },
      ]),
    );
    expect(display.items.some((item) => item.label === "Manual apply command")).toBe(
      false,
    );
    expect(display.artifactLinks.map((artifact) => artifact.label)).toEqual(
      expect.arrayContaining(["Current workflow", "Requirement report"]),
    );
    expect(display.artifactLinks.map((artifact) => artifact.label)).not.toContain(
      "Merge candidate evidence",
    );
  });
});
