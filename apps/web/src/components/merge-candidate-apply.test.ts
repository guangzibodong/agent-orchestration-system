import { describe, expect, it } from "vitest";
import {
  applyMergeCandidate,
  buildMergeCandidateApplyDisplay,
  buildMergeCandidateApplyError
} from "./merge-candidate-apply";

describe("merge candidate apply", () => {
  it("posts merge candidate apply requests and parses the response", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const result = await applyMergeCandidate(async (path, init) => {
      requests.push({ path, init });

      return {
        workflowId: "workflow-1",
        status: "applied",
        repositoryPath: "C:/repo",
        sourceBranches: ["mawo/workflow/task"],
        patchArtifactPath: "C:/artifacts/workflow-1/merge-candidate.patch",
        gitStatus: " M README.md",
        appliedAt: "2026-06-06T02:33:06.171Z"
      };
    }, "workflow-1");

    expect(requests).toEqual([
      {
        path: "/workflows/workflow-1/merge-candidate/apply",
        init: {
          method: "POST",
          body: "{}"
        }
      }
    ]);
    expect(result.status).toBe("applied");
    expect(result.gitStatus).toContain("README.md");
  });

  it("summarizes applied merge candidates for operators", () => {
    expect(
      buildMergeCandidateApplyDisplay({
        workflowId: "workflow-1",
        status: "applied",
        repositoryPath: "C:/repo",
        sourceBranches: ["mawo/workflow/task"],
        patchArtifactPath: "C:/artifacts/workflow-1/merge-candidate.patch",
        gitStatus: " M README.md",
        appliedAt: "2026-06-06T02:33:06.171Z"
      })
    ).toEqual([
      "Merge candidate applied",
      "Repository: C:/repo",
      "Status: M README.md",
      "Patch: C:/artifacts/workflow-1/merge-candidate.patch"
    ]);
  });

  it("formats apply failures with backend reasons", () => {
    expect(
      buildMergeCandidateApplyError({
        error: "merge_candidate_apply_blocked",
        reason: "repository_not_clean",
        message: "Target repository must be clean before applying a merge candidate."
      })
    ).toBe("Apply blocked: repository_not_clean");
  });
});
