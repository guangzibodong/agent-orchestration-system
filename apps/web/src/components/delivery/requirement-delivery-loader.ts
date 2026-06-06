import { requirementDeliveryTicketSchema } from "@mawo/shared";
import type { DeliveryConsoleModel } from "./delivery-console-model";
import {
  buildDeliveryConsoleModel,
  type DeliveryConsoleModelContext
} from "./delivery-console-model";
import {
  loadWorkflowRuns,
  type WorkflowListOptions
} from "../workflow-list-loader";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export async function loadRequirementDeliveryModel(
  api: ApiClient,
  options: WorkflowListOptions = {},
  context: DeliveryConsoleModelContext = {}
): Promise<DeliveryConsoleModel> {
  const [workflowResult, requirementResult] = await Promise.allSettled([
    loadWorkflowRuns(api, options),
    loadRequirementTickets(api, options)
  ]);

  const workflows =
    workflowResult.status === "fulfilled" ? workflowResult.value : [];
  const requirements =
    requirementResult.status === "fulfilled" ? requirementResult.value : [];

  if (
    workflowResult.status === "rejected" &&
    requirementResult.status === "rejected"
  ) {
    throw workflowResult.reason;
  }

  return buildDeliveryConsoleModel(
    workflows,
    new Date(),
    requirements,
    context
  );
}

async function loadRequirementTickets(
  api: ApiClient,
  options: WorkflowListOptions = {}
) {
  const value = await api(buildRequirementListPath(options));
  return requirementDeliveryTicketSchema.array().parse(value);
}

function buildRequirementListPath(options: WorkflowListOptions): string {
  const params = new URLSearchParams();

  if (options.repositoryId) {
    params.set("repositoryId", options.repositoryId);
  }

  if (!params.size) {
    return "/requirements";
  }

  return `/requirements?${params.toString()}`;
}
