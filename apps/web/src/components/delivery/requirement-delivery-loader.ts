import {
  agentHealthSchema,
  auditEventSchema,
  mergeCandidateSchema,
  requirementDeliveryTicketSchema,
  repositorySafetySchema,
  runReportSchema,
  workflowJobSchema
} from "@mawo/shared";
import type {
  AgentHealth,
  AuditEvent,
  MergeCandidate,
  RepositorySafety,
  RequirementDeliveryTicket,
  RunReport,
  WorkflowJob,
  WorkflowRun
} from "@mawo/shared";
import type {
  DeliveryConsoleModel,
  RequirementArtifactLink,
  RequirementAuditTrail,
  RequirementCurrentJob,
  RequirementReviewEvidence,
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
  const [workflowResult, requirementResult, agentHealthResult] =
    await Promise.allSettled([
      loadWorkflowRuns(api, options),
      loadRequirementTickets(api, options),
      loadAgentHealth(api)
    ]);

  const workflows =
    workflowResult.status === "fulfilled" ? workflowResult.value : [];
  const requirements =
    requirementResult.status === "fulfilled" ? requirementResult.value : [];
  const agentHealth =
    agentHealthResult.status === "fulfilled" ? agentHealthResult.value : [];
  const repositorySafetyByRepositoryId =
    requirementResult.status === "fulfilled"
      ? await loadRepositorySafetyForRequirements(api, requirements)
      : {};
  const currentJobByRequirementId =
    requirementResult.status === "fulfilled"
      ? await loadActiveJobsForRequirements(api, requirements)
      : {};
  const jobStatusByRequirementId = Object.fromEntries(
    Object.entries(currentJobByRequirementId).map(([requirementId, job]) => [
      requirementId,
      job?.status
    ])
  );

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
    {
      ...context,
      agentHealth: context.agentHealth ?? agentHealth,
      currentJobByRequirementId: {
        ...currentJobByRequirementId,
        ...context.currentJobByRequirementId
      },
      jobStatusByRequirementId: {
        ...jobStatusByRequirementId,
        ...context.jobStatusByRequirementId
      },
      repositorySafetyByRepositoryId: {
        ...repositorySafetyByRepositoryId,
        ...context.repositorySafetyByRepositoryId
      }
    }
  );

  return loadRequirementArtifactEvidence(api, model);
}

async function loadAgentHealth(api: ApiClient): Promise<AgentHealth[]> {
  const value = await api("/agents/health");
  return agentHealthSchema.array().parse(value);
}

async function loadRequirementTickets(
  api: ApiClient,
  options: WorkflowListOptions = {}
) {
  const value = await api(buildRequirementListPath(options));
  return requirementDeliveryTicketSchema.array().parse(value);
}

async function loadActiveJobsForRequirements(
  api: ApiClient,
  requirements: RequirementDeliveryTicket[]
): Promise<Record<string, RequirementCurrentJob | undefined>> {
  const activeJobRequests = requirements.flatMap((requirement) =>
    requirement.status === "running" && requirement.currentWorkflowRunId
      ? [
          {
            requirementId: requirement.id,
            workflowId: requirement.currentWorkflowRunId
          }
        ]
      : []
  );

  if (!activeJobRequests.length) {
    return {};
  }

  const results = await Promise.allSettled(
    activeJobRequests.map(async ({ requirementId, workflowId }) => ({
      requirementId,
      job: selectNewestActiveJob(
        workflowJobSchema.array().parse(
          await api(buildActiveJobsPath(workflowId))
        )
      )
    }))
  );

  return Object.fromEntries(
    results.flatMap((result) =>
      result.status === "fulfilled" && result.value.job
        ? [[result.value.requirementId, toRequirementCurrentJob(result.value.job)]]
        : []
    )
  );
}

function buildActiveJobsPath(workflowId: string): string {
  const params = new URLSearchParams();
  params.set("workflowId", workflowId);
  params.set("limit", "5");

  return `/jobs?${params.toString()}`;
}

function selectNewestActiveJob(jobs: WorkflowJob[]): WorkflowJob | undefined {
  return jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .at(0);
}

function toRequirementCurrentJob(job: WorkflowJob): RequirementCurrentJob {
  return {
    createdAt: job.createdAt,
    id: job.id,
    status: job.status,
    updatedAt: job.updatedAt,
    workflowId: job.workflowId
  };
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

async function loadRepositorySafetyForRequirements(
  api: ApiClient,
  requirements: RequirementDeliveryTicket[]
): Promise<Record<string, RepositorySafety | undefined>> {
  const safetyRequests = [
    ...new Map(
      requirements.flatMap((requirement) => {
        if (requirement.repositoryId) {
          return [
            [
              requirement.repositoryId,
              `/repositories/${encodeURIComponent(requirement.repositoryId)}/safety`
            ]
          ] satisfies Array<[string, string]>;
        }

        if (requirement.repositoryPath) {
          return [
            [
              requirement.id,
              `/requirements/${encodeURIComponent(requirement.id)}/safety`
            ]
          ] satisfies Array<[string, string]>;
        }

        return [] satisfies Array<[string, string]>;
      })
    ).entries()
  ];

  if (!safetyRequests.length) {
    return {};
  }

  const results = await Promise.allSettled(
    safetyRequests.map(async ([key, path]) => ({
      key,
      safety: repositorySafetySchema.parse(
        await api(path)
      )
    }))
  );

  return Object.fromEntries(
    results.flatMap((result) =>
      result.status === "fulfilled"
        ? [[result.value.key, result.value.safety]]
        : []
    )
  );
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
    model.requirements.map(async (requirement) => {
      const [reviewResult, auditResult] = await Promise.allSettled([
        loadRequirementReviewEvidence(api, requirement),
        loadRequirementAuditTrail(api, requirement)
      ]);
      const reviewEvidence =
        reviewResult.status === "fulfilled"
          ? reviewResult.value
          : { artifactLinks: [] };

      return {
        ...reviewEvidence,
        auditTrail:
          auditResult.status === "fulfilled"
            ? auditResult.value
            : undefined,
        id: requirement.id
      };
    })
  );
  const linksByRequirementId = new Map<string, RequirementArtifactLink[]>();
  const reviewEvidenceByRequirementId = new Map<
    string,
    RequirementReviewEvidence
  >();
  const auditTrailByRequirementId = new Map<string, RequirementAuditTrail>();

  for (const result of evidenceResults) {
    if (
      result.status === "fulfilled" &&
      result.value.artifactLinks.length > 0
    ) {
      linksByRequirementId.set(result.value.id, result.value.artifactLinks);
    }

    if (result.status === "fulfilled" && result.value.reviewEvidence) {
      reviewEvidenceByRequirementId.set(
        result.value.id,
        result.value.reviewEvidence
      );
    }

    if (
      result.status === "fulfilled" &&
      result.value.auditTrail?.events.length
    ) {
      auditTrailByRequirementId.set(result.value.id, result.value.auditTrail);
    }
  }

  if (
    !linksByRequirementId.size &&
    !reviewEvidenceByRequirementId.size &&
    !auditTrailByRequirementId.size
  ) {
    return model;
  }

  return {
    ...model,
    requirements: model.requirements.map((requirement) => {
      const artifactLinks = linksByRequirementId.get(requirement.id);
      const reviewEvidence = reviewEvidenceByRequirementId.get(requirement.id);
      const auditTrail = auditTrailByRequirementId.get(requirement.id);

      return artifactLinks || reviewEvidence || auditTrail
        ? {
            ...requirement,
            ...(artifactLinks ? { artifactLinks } : {}),
            ...(reviewEvidence ? { reviewEvidence } : {}),
            ...(auditTrail ? { auditTrail } : {})
          }
        : requirement;
    })
  };
}

async function loadRequirementAuditTrail(
  api: ApiClient,
  requirement: RequirementSummary
): Promise<RequirementAuditTrail | undefined> {
  const paths = buildRequirementAuditPaths(requirement);

  if (!paths.length) {
    return undefined;
  }

  const results = await Promise.allSettled(
    paths.map(async (path) => auditEventSchema.array().parse(await api(path)))
  );
  const events = dedupeAuditEvents(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    )
  ).sort(compareAuditEventsNewestFirst);

  return events.length ? { events: events.slice(0, 8) } : undefined;
}

function buildRequirementAuditPaths(requirement: RequirementSummary): string[] {
  return distinctStrings([
    buildAuditPath("requirementId", requirement.id),
    requirement.workflowRunId
      ? buildAuditPath("workflowId", requirement.workflowRunId)
      : undefined
  ]);
}

function buildAuditPath(
  key: "requirementId" | "workflowId",
  value: string
): string {
  const params = new URLSearchParams();
  params.set(key, value);
  params.set("limit", "8");

  return `/audit-events?${params.toString()}`;
}

function dedupeAuditEvents(events: AuditEvent[]): AuditEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

function compareAuditEventsNewestFirst(
  left: AuditEvent,
  right: AuditEvent
): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

async function loadRequirementReviewEvidence(
  api: ApiClient,
  requirement: RequirementSummary
): Promise<{
  artifactLinks: RequirementArtifactLink[];
  reviewEvidence?: RequirementReviewEvidence;
}> {
  const [reportResult, mergeCandidateResult] = await Promise.allSettled([
    shouldLoadReportArtifacts(requirement)
      ? loadRequirementReport(api, requirement)
      : Promise.resolve(undefined),
    shouldLoadMergeCandidate(requirement)
      ? loadRequirementMergeCandidate(api, requirement)
      : Promise.resolve(undefined)
  ]);

  const report =
    reportResult.status === "fulfilled" ? reportResult.value : undefined;
  const mergeCandidate =
    mergeCandidateResult.status === "fulfilled"
      ? mergeCandidateResult.value
      : undefined;
  const currentReport = matchesCurrentWorkflowEvidence(requirement, report)
    ? report
    : undefined;
  const currentMergeCandidate = matchesCurrentWorkflowEvidence(
    requirement,
    mergeCandidate
  )
    ? mergeCandidate
    : undefined;

  if (!currentReport && !currentMergeCandidate) {
    const supersededWorkflowId = findSupersededEvidenceWorkflowId(
      requirement,
      report,
      mergeCandidate
    );

    if (supersededWorkflowId) {
      return {
        artifactLinks: [],
        reviewEvidence:
          buildSupersededRequirementReviewEvidence(supersededWorkflowId)
      };
    }

    return { artifactLinks: [] };
  }

  const artifactLinks = [
    ...(currentReport
      ? buildReportArtifactLinks(requirement, currentReport)
      : []),
    ...(currentMergeCandidate
      ? buildMergeCandidateArtifactLinks(requirement, currentMergeCandidate)
      : [])
  ];

  return {
    artifactLinks,
    reviewEvidence: buildRequirementReviewEvidence(
      requirement,
      currentReport,
      currentMergeCandidate
    )
  };
}

function matchesCurrentWorkflowEvidence(
  requirement: RequirementSummary,
  evidence: { workflowId?: string } | undefined
): boolean {
  if (!evidence) {
    return false;
  }

  if (!requirement.workflowRunId || !evidence.workflowId) {
    return true;
  }

  return evidence.workflowId === requirement.workflowRunId;
}

function findSupersededEvidenceWorkflowId(
  requirement: RequirementSummary,
  report: RunReport | undefined,
  mergeCandidate: MergeCandidate | undefined
): string | undefined {
  for (const evidence of [mergeCandidate, report]) {
    if (
      evidence &&
      !matchesCurrentWorkflowEvidence(requirement, evidence) &&
      evidence.workflowId
    ) {
      return evidence.workflowId;
    }
  }

  return undefined;
}

function buildSupersededRequirementReviewEvidence(
  evidenceSourceWorkflowId: string
): RequirementReviewEvidence {
  return {
    evidenceSourceWorkflowId,
    changedFiles: [],
    patchArtifactPaths: [],
    gateResults: []
  };
}

async function loadRequirementReport(
  api: ApiClient,
  requirement: RequirementSummary
): Promise<RunReport> {
  return runReportSchema.parse(await api(buildReportPath(requirement)));
}

async function loadRequirementMergeCandidate(
  api: ApiClient,
  requirement: RequirementSummary
): Promise<MergeCandidate> {
  return mergeCandidateSchema.parse(
    await api(buildMergeCandidatePath(requirement))
  );
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

function shouldLoadMergeCandidate(requirement: RequirementSummary): boolean {
  return Boolean(
    requirement.workflowRunId &&
      (requirement.executionStatus === "needs_review" ||
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

function buildMergeCandidatePath(requirement: RequirementSummary): string {
  if (requirement.source === "workflow") {
    return `/workflows/${encodeURIComponent(
      requirement.workflowRunId ?? requirement.id
    )}/merge-candidate`;
  }

  return `/requirements/${encodeURIComponent(
    requirement.id
  )}/merge-candidate`;
}

function buildRequirementReviewEvidence(
  requirement: RequirementSummary,
  report: RunReport | undefined,
  mergeCandidate: MergeCandidate | undefined
): RequirementReviewEvidence {
  const evidenceSourceWorkflowId =
    mergeCandidate?.workflowId ?? report?.workflowId ?? requirement.workflowRunId;
  const gateDefinitionsById = new Map(
    (requirement.qualityGateDefinitions ?? []).map((gate) => [gate.id, gate])
  );
  const patchArtifactPaths = distinctStrings([
    ...(report?.taskResults.map((task) => task.patchArtifactPath) ?? []),
    mergeCandidate?.patchArtifactPath
  ]);
  const changedFiles = distinctStrings(
    extractChangedFiles([
      ...(report?.taskResults.map((task) => task.patch) ?? []),
      mergeCandidate?.patch
    ])
  );

  return {
    ...(evidenceSourceWorkflowId ? { evidenceSourceWorkflowId } : {}),
    ...(report?.summary ? { reportSummary: report.summary } : {}),
    ...(report?.recommendation
      ? { reportRecommendation: report.recommendation }
      : {}),
    ...buildReportDurationEvidence(report),
    changedFiles,
    patchArtifactPaths,
    gateResults:
      report?.gateResults.map((gate) => {
        const definition = gateDefinitionsById.get(gate.id);

        return {
          id: gate.id,
          title: gate.title,
          status: gate.status,
          ...(definition?.command ? { command: definition.command } : {}),
          required: definition?.required ?? true,
          ...(gate.exitCode === undefined ? {} : { exitCode: gate.exitCode })
        };
      }) ?? [],
    ...(mergeCandidate
      ? {
          mergeCandidate: {
            status: mergeCandidate.status,
            summary: mergeCandidate.summary,
            sourceBranches: mergeCandidate.sourceBranches,
            ...(mergeCandidate.patchArtifactPath
              ? { patchArtifactPath: mergeCandidate.patchArtifactPath }
              : {}),
            ...(mergeCandidate.manifestArtifactPath
              ? { manifestArtifactPath: mergeCandidate.manifestArtifactPath }
              : {}),
            ...(mergeCandidate.applyCommand
              ? { applyCommand: mergeCandidate.applyCommand }
              : {}),
            createdAt: mergeCandidate.createdAt
          }
        }
      : {})
  };
}

function buildReportDurationEvidence(
  report: RunReport | undefined
): Pick<RequirementReviewEvidence, "totalDurationMs"> {
  if (!report) {
    return {};
  }

  const durations = [
    ...report.taskResults.map((task) => task.durationMs),
    ...report.gateResults.map((gate) => gate.durationMs)
  ].filter((duration): duration is number =>
    duration !== undefined && Number.isFinite(duration) && duration >= 0
  );

  if (!durations.length) {
    return {};
  }

  return {
    totalDurationMs: durations.reduce((total, duration) => total + duration, 0)
  };
}

function buildMergeCandidateArtifactLinks(
  requirement: RequirementSummary,
  mergeCandidate: MergeCandidate
): RequirementArtifactLink[] {
  const workflowId = mergeCandidate.workflowId || requirement.workflowRunId;

  if (!workflowId) {
    return [];
  }

  const links: RequirementArtifactLink[] = [];

  if (mergeCandidate.patchArtifactPath) {
    links.push(
      buildArtifactLink({
        id: `${requirement.id}:merge-candidate:patch`,
        kind: "patch",
        label: "Merge candidate patch artifact",
        meta: "Manual git apply patch",
        path: mergeCandidate.patchArtifactPath,
        workflowId
      })
    );
  }

  if (mergeCandidate.manifestArtifactPath) {
    links.push(
      buildArtifactLink({
        id: `${requirement.id}:merge-candidate:manifest`,
        kind: "report",
        label: "Merge candidate manifest",
        meta: mergeCandidate.summary,
        path: mergeCandidate.manifestArtifactPath,
        workflowId
      })
    );
  }

  return links;
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

function extractChangedFiles(patches: Array<string | undefined>): string[] {
  const files: string[] = [];

  for (const patch of patches) {
    if (!patch) {
      continue;
    }

    for (const line of patch.split(/\r?\n/)) {
      const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (diffMatch) {
        files.push(normalizePatchPath(diffMatch[2] ?? diffMatch[1]));
        continue;
      }

      const newFileMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (newFileMatch) {
        files.push(normalizePatchPath(newFileMatch[1]));
      }
    }
  }

  return files.filter((file) => file && file !== "/dev/null");
}

function normalizePatchPath(path: string | undefined): string {
  return (path ?? "").replace(/^"|"$/g, "");
}

function distinctStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
