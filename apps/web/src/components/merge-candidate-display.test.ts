import { describe, expect, it } from "vitest";
import { buildMergeCandidateDisplay } from "./merge-candidate-display";

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
});
