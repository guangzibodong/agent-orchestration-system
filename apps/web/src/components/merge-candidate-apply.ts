import {
  mergeCandidateApplyResultSchema,
  type MergeCandidateApplyResult
} from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export type MergeCandidateApplyBlockedResponse = {
  error: "merge_candidate_apply_blocked";
  reason: string;
  message?: string;
};

export async function applyMergeCandidate(
  api: ApiClient,
  workflowId: string
): Promise<MergeCandidateApplyResult> {
  return mergeCandidateApplyResultSchema.parse(
    await api(`/workflows/${workflowId}/merge-candidate/apply`, {
      method: "POST",
      body: "{}"
    })
  );
}

export function buildMergeCandidateApplyDisplay(
  result: MergeCandidateApplyResult
): string[] {
  return [
    "Merge candidate applied",
    `Repository: ${result.repositoryPath}`,
    `Status: ${result.gitStatus.trim() || "No pending git status"}`,
    ...(result.patchArtifactPath ? [`Patch: ${result.patchArtifactPath}`] : [])
  ];
}

export function buildMergeCandidateApplyError(value: unknown): string | undefined {
  if (!isMergeCandidateApplyBlockedResponse(value)) {
    return undefined;
  }

  return `Apply blocked: ${value.reason}`;
}

function isMergeCandidateApplyBlockedResponse(
  value: unknown
): value is MergeCandidateApplyBlockedResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Partial<MergeCandidateApplyBlockedResponse>;
  return (
    body.error === "merge_candidate_apply_blocked" &&
    typeof body.reason === "string"
  );
}
