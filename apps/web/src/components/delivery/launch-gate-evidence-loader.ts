import {
  launchGateEvidenceSchema,
  type LaunchGateEvidence,
} from "@mawo/shared";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export async function loadLatestLaunchGateEvidence(
  api: ApiClient,
): Promise<LaunchGateEvidence | undefined> {
  try {
    return launchGateEvidenceSchema.parse(
      await api("/launch/evidence/latest"),
    );
  } catch {
    return undefined;
  }
}
