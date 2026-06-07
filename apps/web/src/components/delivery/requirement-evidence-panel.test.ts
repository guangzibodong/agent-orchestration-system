import { describe, expect, it } from "vitest";
import type { RequirementSummary } from "./delivery-console-model";
import { buildRequirementEvidenceDisplay } from "./requirement-evidence-panel";

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
