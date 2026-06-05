import { describe, expect, it } from "vitest";
import {
  buildMergeCandidateDisplay,
  buildMergeCandidateNotReadyDisplay,
  isMergeCandidateNotReadyResponse
} from "./merge-candidate-display";

describe("merge candidate display", () => {
  it("formats ready merge candidates with artifact paths and apply commands", () => {
    const display = buildMergeCandidateDisplay({
      workflowId: "run_1",
      status: "ready",
      summary: "1 task patch ready to apply",
      sourceBranches: ["mawo/run/task"],
      patch: "diff --git a/README.md b/README.md",
      patchArtifactPath: "C:/artifacts/run_1/merge-candidate.patch",
      manifestArtifactPath: "C:/artifacts/run_1/merge-candidate.json",
      applyCommand:
        'git -C "C:/repo" apply "C:/artifacts/run_1/merge-candidate.patch"',
      createdAt: "2026-06-04T00:00:00.000Z"
    });

    expect(display.lines).toEqual([
      "ready",
      "1 task patch ready to apply",
      "Patch: C:/artifacts/run_1/merge-candidate.patch",
      "Apply: git -C \"C:/repo\" apply \"C:/artifacts/run_1/merge-candidate.patch\""
    ]);
  });

  it("recognizes API responses that block merge candidates until review-ready", () => {
    expect(
      isMergeCandidateNotReadyResponse({
        error: "merge_candidate_not_ready",
        status: "gate_failed",
        message: "Workflow is gate_failed; merge candidate requires review-ready work."
      })
    ).toBe(true);
    expect(isMergeCandidateNotReadyResponse({ error: "workflow_not_found" })).toBe(
      false
    );
  });

  it("formats blocked merge candidates as actionable quality-gate status", () => {
    const display = buildMergeCandidateNotReadyDisplay({
      error: "merge_candidate_not_ready",
      status: "gate_failed",
      message: "Workflow is gate_failed; merge candidate requires review-ready work."
    });

    expect(display).toEqual({
      tone: "blocked",
      lines: [
        "Merge candidate blocked",
        "Workflow is gate_failed; rerun or retry after quality gates pass.",
        "No patch will be offered until the workflow reaches needs_review or completed."
      ]
    });
  });
});
