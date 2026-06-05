import type { MergeCandidate } from "@mawo/shared";

export type MergeCandidateNotReadyResponse = {
  error: "merge_candidate_not_ready";
  message?: string;
  status?: string;
};

export type MergeCandidateDisplay = {
  tone?: "ready" | "blocked";
  lines: string[];
};

export function buildMergeCandidateDisplay(
  candidate: MergeCandidate
): MergeCandidateDisplay {
  return {
    lines: [
      candidate.status,
      candidate.summary,
      ...(candidate.patchArtifactPath
        ? [`Patch: ${candidate.patchArtifactPath}`]
        : []),
      ...(candidate.applyCommand ? [`Apply: ${candidate.applyCommand}`] : [])
    ]
  };
}

export function isMergeCandidateNotReadyResponse(
  value: unknown
): value is MergeCandidateNotReadyResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<MergeCandidateNotReadyResponse>;
  return body.error === "merge_candidate_not_ready";
}

export function buildMergeCandidateNotReadyDisplay(
  response: MergeCandidateNotReadyResponse
): MergeCandidateDisplay {
  const status = response.status ?? "not_ready";
  return {
    tone: "blocked",
    lines: [
      "Merge candidate blocked",
      `Workflow is ${status}; rerun or retry after quality gates pass.`,
      "No patch will be offered until the workflow reaches needs_review or completed."
    ]
  };
}
