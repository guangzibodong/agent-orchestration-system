import { describe, expect, it } from "vitest";
import { loadLatestLaunchGateEvidence } from "./launch-gate-evidence-loader";

describe("latest launch gate evidence loader", () => {
  it("loads and validates the latest launch evidence contract", async () => {
    const evidence = await loadLatestLaunchGateEvidence(async (path) => {
      expect(path).toBe("/launch/evidence/latest");

      return {
        generatedAt: "2026-06-06T16:35:25.938Z",
        root: "C:/work",
        branch: "main",
        commit: "cfa22af",
        dirtyFiles: [],
        checks: [],
        docs: [],
        localDecision: "passed",
        productionDecision: "blocked",
        failureSummaries: [],
        externalBlockers: [
          "smoke_api_postgres: DATABASE_URL is not configured.",
        ],
        sourcePath: "C:/work/output/launch-readiness/latest.json",
      };
    });

    expect(evidence?.localDecision).toBe("passed");
    expect(evidence?.externalBlockers).toHaveLength(1);
  });

  it("treats missing evidence as optional for older or clean environments", async () => {
    const evidence = await loadLatestLaunchGateEvidence(async () => {
      throw new Error("404");
    });

    expect(evidence).toBeUndefined();
  });
});
