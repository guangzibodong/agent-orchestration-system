import { requirementDeliveryTicketSchema, runReportSchema } from "@mawo/shared";
import type { RunReport, WorkflowRun } from "@mawo/shared";
import type {
  DeliveryConsoleModel,
  RequirementArtifactLink,
  RequirementSummary
} from "./delivery-console-model";
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

  const model = buildDeliveryConsoleModel(
    mergeWorkflowOverrides(workflows, context.workflowOverrides ?? []),
    new Date(),
    requirements,
    context
  );

  return loadRequirementArtifactEvidence(api, model);
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

function mergeWorkflowOverrides(
  workflows: WorkflowRun[],
  overrides: WorkflowRun[]
): WorkflowRun[] {
  if (!overrides.length) {
    return workflows;
  }

  const merged = new Map(workflows.map((workflow) => [workflow.id, workflow]));

  for (const override of overrides) {
    const current = merged.get(override.id);

    if (!current || shouldPreferWorkflowOverride(current, override)) {
      merged.set(override.id, override);
    }
  }

  return [...merged.values()];
}

function shouldPreferWorkflowOverride(
  current: WorkflowRun,
  override: WorkflowRun
): boolean {
  const currentUpdatedAt = Date.parse(current.updatedAt ?? current.createdAt ?? "");
  const overrideUpdatedAt = Date.parse(
    override.updatedAt ?? override.createdAt ?? ""
  );

  if (Number.isNaN(currentUpdatedAt) || Number.isNaN(overrideUpdatedAt)) {
    return true;
  }

  return overrideUpdatedAt >= currentUpdatedAt;
}

async function loadRequirementArtifactEvidence(
  api: ApiClient,
  model: DeliveryConsoleModel
): Promise<DeliveryConsoleModel> {
  const evidenceResults = await Promise.allSettled(
    model.requirements.map(async (requirement) => ({
      artifactLinks: await loadRequirementReportArtifactLinks(api, requirement),
      id: requirement.id
    }))
  );
  const linksByRequirementId = new Map<string, RequirementArtifactLink[]>();

  for (const result of evidenceResults) {
    if (
      result.status === "fulfilled" &&
      result.value.artifactLinks.length > 0
    ) {
      linksByRequirementId.set(result.value.id, result.value.artifactLinks);
    }
  }

  if (!linksByRequirementId.size) {
    return model;
  }

  return {
    ...model,
    requirements: model.requirements.map((requirement) => {
      const artifactLinks = linksByRequirementId.get(requirement.id);

      return artifactLinks
        ? {
            ...requirement,
            artifactLinks
          }
        : requirement;
    })
  };
}

async function loadRequirementReportArtifactLinks(
  api: ApiClient,
  requirement: RequirementSummary
): Promise<RequirementArtifactLink[]> {
  if (!shouldLoadReportArtifacts(requirement)) {
    return [];
  }

  try {
    const report = runReportSchema.parse(await api(buildReportPath(requirement)));
    return buildReportArtifactLinks(requirement, report);
  } catch {
    return [];
  }
}

function shouldLoadReportArtifacts(requirement: RequirementSummary): boolean {
  return Boolean(
    requirement.workflowRunId &&
      (requirement.executionStatus === "needs_review" ||
        requirement.executionStatus === "gate_failed" ||
        requirement.executionStatus === "failed" ||
        requirement.executionStatus === "completed")
  );
}

function buildReportPath(requirement: RequirementSummary): string {
  if (requirement.source === "workflow") {
    return `/workflows/${encodeURIComponent(
      requirement.workflowRunId ?? requirement.id
    )}/report`;
  }

  return `/requirements/${encodeURIComponent(requirement.id)}/report`;
}

function buildReportArtifactLinks(
  requirement: RequirementSummary,
  report: RunReport
): RequirementArtifactLink[] {
  const workflowId = report.workflowId || requirement.workflowRunId;

  if (!workflowId) {
    return [];
  }

  const links: RequirementArtifactLink[] = [];

  if (report.reportArtifactPath) {
    links.push(
      buildArtifactLink({
        id: `${requirement.id}:report-artifact`,
        kind: "report",
        label: "Report artifact",
        meta: report.recommendation,
        path: report.reportArtifactPath,
        workflowId
      })
    );
  }

  for (const task of report.taskResults) {
    if (task.stdoutArtifactPath) {
      links.push(
        buildArtifactLink({
          id: `${requirement.id}:task:${task.id}:stdout`,
          kind: "stdout",
          label: `${task.title} stdout`,
          meta: `${task.id} / ${task.status}`,
          path: task.stdoutArtifactPath,
          workflowId
        })
      );
    }

    if (task.stderrArtifactPath) {
      links.push(
        buildArtifactLink({
          id: `${requirement.id}:task:${task.id}:stderr`,
          kind: "stderr",
          label: `${task.title} stderr`,
          meta: `${task.id} / ${task.status}`,
          path: task.stderrArtifactPath,
          workflowId
        })
      );
    }

    if (task.patchArtifactPath) {
      links.push(
        buildArtifactLink({
          id: `${requirement.id}:task:${task.id}:patch`,
          kind: "patch",
          label: `${task.title} patch`,
          meta: `${task.id} / ${task.status}`,
          path: task.patchArtifactPath,
          workflowId
        })
      );
    }
  }

  for (const gate of report.gateResults) {
    if (gate.stdoutArtifactPath) {
      links.push(
        buildArtifactLink({
          id: `${requirement.id}:gate:${gate.id}:stdout`,
          kind: "stdout",
          label: `${gate.title} stdout`,
          meta: `${gate.id} / ${gate.status}`,
          path: gate.stdoutArtifactPath,
          workflowId
        })
      );
    }

    if (gate.stderrArtifactPath) {
      links.push(
        buildArtifactLink({
          id: `${requirement.id}:gate:${gate.id}:stderr`,
          kind: "stderr",
          label: `${gate.title} stderr`,
          meta: `${gate.id} / ${gate.status}`,
          path: gate.stderrArtifactPath,
          workflowId
        })
      );
    }
  }

  return links;
}

function buildArtifactLink({
  id,
  kind,
  label,
  meta,
  path,
  workflowId
}: {
  id: string;
  kind: RequirementArtifactLink["kind"];
  label: string;
  meta?: string;
  path: string;
  workflowId: string;
}): RequirementArtifactLink {
  return {
    id,
    kind,
    label,
    href: `/workflows/${encodeURIComponent(
      workflowId
    )}/artifact?path=${encodeURIComponent(path)}`,
    meta,
    path
  };
}
