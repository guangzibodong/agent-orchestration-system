import {
  workflowReviewRequestSchema,
  type WorkflowReviewRequest
} from "@mawo/shared";

export function buildWorkflowReviewPayload(
  decision: WorkflowReviewRequest["decision"]
): WorkflowReviewRequest {
  return workflowReviewRequestSchema.parse({
    decision
  });
}
