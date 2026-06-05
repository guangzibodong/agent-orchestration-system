import type { MergeCandidate } from "@mawo/shared";

export type MergeCandidateDisplay = {
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
