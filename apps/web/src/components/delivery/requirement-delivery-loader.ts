import type { DeliveryConsoleModel } from "./delivery-console-model";
import { buildDeliveryConsoleModel } from "./delivery-console-model";
import {
  loadWorkflowRuns,
  type WorkflowListOptions
} from "../workflow-list-loader";

type ApiClient = (path: string, init?: RequestInit) => Promise<unknown>;

export async function loadRequirementDeliveryModel(
  api: ApiClient,
  options: WorkflowListOptions = {}
): Promise<DeliveryConsoleModel> {
  const workflows = await loadWorkflowRuns(api, options);
  return buildDeliveryConsoleModel(workflows);
}
