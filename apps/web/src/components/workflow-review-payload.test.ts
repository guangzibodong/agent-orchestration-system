import { describe, expect, it } from "vitest";
import { buildWorkflowReviewPayload } from "./workflow-review-payload";

describe("workflow review payload", () => {
  it("builds approve and reject review requests", () => {
    expect(buildWorkflowReviewPayload("approve")).toEqual({
      decision: "approve"
    });
    expect(buildWorkflowReviewPayload("reject")).toEqual({
      decision: "reject"
    });
  });
});
