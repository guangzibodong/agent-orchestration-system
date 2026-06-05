import { describe, expect, it } from "vitest";
import {
  buildArtifactPreviewDisplay,
  buildArtifactPreviewPath
} from "./artifact-preview";

describe("artifact preview", () => {
  it("builds a bounded artifact API path with an encoded artifact path", () => {
    expect(
      buildArtifactPreviewPath({
        workflowId: "workflow-1",
        artifactPath: "C:/mawo/artifacts/workflow-1/report.json",
        maxBytes: 2048
      })
    ).toBe(
      "/workflows/workflow-1/artifact?maxBytes=2048&path=C%3A%2Fmawo%2Fartifacts%2Fworkflow-1%2Freport.json"
    );
  });

  it("summarizes truncated previews for operators", () => {
    expect(
      buildArtifactPreviewDisplay({
        workflowId: "workflow-1",
        path: "C:/mawo/artifacts/workflow-1/report.json",
        content: "{\"summary\":\"ready\"}",
        contentType: "text/plain; charset=utf-8",
        sizeBytes: 90000,
        maxBytes: 65536,
        truncated: true
      })
    ).toEqual({
      title: "report.json",
      meta: "65,536 of 90,000 bytes loaded",
      content: "{\"summary\":\"ready\"}",
      truncated: true
    });
  });
});
