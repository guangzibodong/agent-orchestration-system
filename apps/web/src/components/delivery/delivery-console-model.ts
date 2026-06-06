import type {
  RequirementDeliveryTicket,
  RepositorySafety,
  WorkflowJobStatus,
  WorkflowRun,
  WorkflowStatus
} from "@mawo/shared";

export type RequirementStage =
  | "draft"
  | "needs_clarification"
  | "plan_review"
  | "ready_to_run"
  | "running"
  | "needs_review"
  | "delivered"
  | "needs_rework"
  | "archived";

export type RequirementRiskLevel = "low" | "medium" | "high";

export type RepositorySafetySummary = {
  repositoryLabel: string;
  executionModeLabel: string;
  statusLabel?: string;
  statusTone?: "danger" | "muted" | "success" | "warning";
  branchLabel: string;
  headLabel: string;
  cleanStateLabel: string;
  allowedRootLabel: string;
  mergePolicyLabel: string;
  blockedReason?: string;
  recoveryAction: string;
};

export type RequirementLifecycleAction = "confirm-plan" | "enqueue" | "retry";
export type RequirementReviewAction = "approve" | "reject";

export type RequirementArtifactLink = {
  id: string;
  kind: "stdout" | "stderr" | "patch" | "report" | "audit";
  label: string;
  href: string;
  meta?: string;
  path?: string;
};

export type RequirementQualityGateDefinition = {
  id: string;
  title: string;
  command?: string;
  required: boolean;
};

export type RequirementReviewEvidence = {
  evidenceSourceWorkflowId?: string;
  reportSummary?: string;
  reportRecommendation?: string;
  changedFiles: string[];
  patchArtifactPaths: string[];
  gateResults: Array<{
    id: string;
    title: string;
    status: string;
    command?: string;
    required: boolean;
    exitCode?: number;
  }>;
  mergeCandidate?: {
    status: "ready" | "empty";
    summary: string;
    sourceBranches: string[];
    patchArtifactPath?: string;
    manifestArtifactPath?: string;
    applyCommand?: string;
    createdAt: string;
  };
};

export type RequirementSummary = {
  id: string;
  source?: "requirement" | "workflow";
  title: string;
  repositoryLabel: string;
  repositorySafety: RepositorySafetySummary;
  requirementStage: RequirementStage;
  executionStatus: WorkflowRun["status"];
  riskLevel: RequirementRiskLevel;
  nextAction: string;
  nodeLabel: string;
  updatedAt: string;
  currentJobStatus?: WorkflowJobStatus;
  workflowRunHref?: string;
  workflowRunId?: string;
  workflowRunStatus?: WorkflowRun["status"];
  workflowRunStatusLabel: string;
  reviewDecision?: "approved" | "rejected";
  artifactLinks?: RequirementArtifactLink[];
  qualityGateDefinitions?: RequirementQualityGateDefinition[];
  reviewEvidence?: RequirementReviewEvidence;
  availableActions: RequirementLifecycleAction[];
};

export type DeliveryDecisionSeverity = "info" | "warning" | "danger";

export type DeliveryDecisionItem = {
  id: string;
  requirementId: string;
  title: string;
  actionLabel: string;
  severity: DeliveryDecisionSeverity;
};

export type DeliveryConsoleKpis = {
  activeRequirements: number;
  needsClarification: number;
  runningTasks: number;
  failedGates: number;
  waitingForReview: number;
  deliveredLastSevenDays: number;
};

export type DeliveryConsoleModel = {
  requirements: RequirementSummary[];
  kpis: DeliveryConsoleKpis;
  decisionQueue: DeliveryDecisionItem[];
};

export type DeliveryConsoleModelContext = {
  jobStatusByRequirementId?: Record<string, WorkflowJobStatus | undefined>;
  repositorySafetyByRepositoryId?: Record<string, RepositorySafety | undefined>;
  workflowOverrides?: WorkflowRun[];
};

const noAutoMergePolicyLabel =
  "No MAWO auto-merge; manual git apply outside MAWO";

const statusStageMap: Record<WorkflowRun["status"], RequirementStage> = {
  draft: "draft",
  ready: "ready_to_run",
  running: "running",
  gate_failed: "needs_rework",
  needs_review: "needs_review",
  completed: "delivered",
  aborted: "needs_rework",
  archived: "archived",
  failed: "needs_rework"
};

function buildNodeLabel(workflow: WorkflowRun): string {
  const taskCount = workflow.tasks.length;
  const gateCount = workflow.qualityGates.length;
  const taskLabel = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  const gateLabel = `${gateCount} ${gateCount === 1 ? "gate" : "gates"}`;

  return `${taskLabel} / ${gateLabel}`;
}

function mapRiskLevel(workflow: WorkflowRun): RequirementRiskLevel {
  if (workflow.status === "gate_failed" || workflow.status === "failed") {
    return "high";
  }

  if (workflow.status === "completed" && workflow.review?.decision === "approved") {
    return "low";
  }

  return "medium";
}

function mapNextAction(workflow: WorkflowRun): string {
  switch (workflow.status) {
    case "draft":
      return "Complete requirement";
    case "ready":
      return "Run isolated workflow";
    case "running":
      return "View execution";
    case "gate_failed":
      return "Retry failed gate";
    case "needs_review":
      return "Review merge candidate";
    case "completed":
      return "Review delivered evidence";
    case "aborted":
      return "Retry canceled workflow";
    case "failed":
      return "Retry failed workflow";
    case "archived":
      return "View archived evidence";
  }
}

function mapRequirementNextAction(
  requirement: RequirementDeliveryTicket,
  workflowStatus?: WorkflowStatus
): string {
  switch (requirement.status) {
    case "draft":
      return "Complete requirement";
    case "needs_clarification":
      return "Clarify requirement";
    case "plan_review":
      return "Confirm plan";
    case "ready_to_run":
      return "Enqueue";
    case "running":
      return "View execution";
    case "needs_review":
      return "Review merge candidate";
    case "delivered":
      return "Review delivered evidence";
    case "needs_rework":
      return workflowStatus === "gate_failed"
        ? "Retry failed gate"
        : "Retry workflow";
    case "archived":
      return "View archived evidence";
  }
}

function mapRequirementExecutionStatus(
  requirement: RequirementDeliveryTicket,
  workflowStatus?: WorkflowStatus
): WorkflowRun["status"] {
  if (workflowStatus) {
    return workflowStatus;
  }

  switch (requirement.status) {
    case "ready_to_run":
      return "ready";
    case "running":
      return "running";
    case "needs_review":
      return "needs_review";
    case "delivered":
      return "completed";
    case "needs_rework":
      return "failed";
    case "archived":
      return "archived";
    case "draft":
    case "needs_clarification":
    case "plan_review":
      return "draft";
  }
}

function buildRequirementNodeLabel(
  requirement: RequirementDeliveryTicket
): string {
  const taskCount = requirement.tasks.length;
  const gateCount = requirement.qualityGates.length;
  const taskLabel = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  const gateLabel = `${gateCount} ${gateCount === 1 ? "gate" : "gates"}`;

  return `${taskLabel} / ${gateLabel}`;
}

function mapRequirementRiskLevel(
  requirement: RequirementDeliveryTicket,
  workflowStatus?: WorkflowStatus
): RequirementRiskLevel {
  if (
    requirement.status === "needs_rework" ||
    workflowStatus === "gate_failed" ||
    workflowStatus === "failed"
  ) {
    return "high";
  }

  if (requirement.status === "delivered") {
    return "low";
  }

  return requirement.riskLevel;
}

function buildTicketRepositorySafety(
  requirement: RequirementDeliveryTicket,
  executionStatus: WorkflowRun["status"],
  workflow?: WorkflowRun,
  repositorySafety?: RepositorySafety
): RepositorySafetySummary {
  if (workflow) {
    return buildRepositorySafety(workflow);
  }

  if (repositorySafety) {
    return buildRepositorySafetyFromInspection(requirement, repositorySafety);
  }

  const hasRepository = Boolean(
    requirement.repositoryPath || requirement.repositoryId
  );

  return {
    repositoryLabel:
      requirement.repositoryPath ??
      requirement.repositoryId ??
      "No repository selected",
    executionModeLabel: "Isolated worktree",
    branchLabel: "Branch pending preflight",
    headLabel: "HEAD SHA not reported",
    cleanStateLabel: hasRepository
      ? requirement.status === "needs_review" ||
        requirement.status === "delivered" ||
        requirement.status === "needs_rework"
        ? "Apply clean check required"
        : "Clean state pending preflight"
      : "No repository selected",
    allowedRootLabel: hasRepository
      ? hasRequirementPreflightEvidence(executionStatus)
        ? "Allowed root accepted by API"
        : "Allowed root pending preflight"
      : "Allowed root not checked",
    mergePolicyLabel: noAutoMergePolicyLabel,
    blockedReason: buildTicketBlockedReason(
      requirement,
      hasRepository,
      executionStatus
    ),
    recoveryAction: buildTicketRecoveryAction(requirement, hasRepository)
  };
}

function buildRepositorySafetyFromInspection(
  requirement: RequirementDeliveryTicket,
  safety: RepositorySafety
): RepositorySafetySummary {
  const repositoryLabel =
    safety.path ??
    requirement.repositoryPath ??
    requirement.repositoryId ??
    "No repository selected";

  return {
    repositoryLabel,
    executionModeLabel: "Isolated worktree",
    statusLabel: safety.blockedReason ? "Safety blocked" : "Safety accepted",
    statusTone: safety.blockedReason ? "danger" : "success",
    branchLabel:
      safety.currentBranch ?? safety.defaultBranch ?? "Branch pending preflight",
    headLabel: safety.headShortSha
      ? `HEAD ${safety.headShortSha}`
      : "HEAD SHA not reported",
    cleanStateLabel: buildInspectedCleanStateLabel(safety),
    allowedRootLabel: safety.allowedRoot
      ? "Allowed root accepted by API"
      : "Outside allowed roots - blocked",
    mergePolicyLabel: noAutoMergePolicyLabel,
    blockedReason: safety.blockedReason
      ? formatRepositorySafetyBlockedReason(safety.blockedReason)
      : undefined,
    recoveryAction:
      safety.recoveryAction ??
      (safety.blockedReason
        ? "Resolve repository safety before mutating actions"
        : "Repository safety accepted for isolated requirement runs")
  };
}

function buildInspectedCleanStateLabel(safety: RepositorySafety): string {
  if (!safety.allowedRoot) {
    return "Clean state unavailable";
  }

  if (safety.dirty) {
    return "Dirty - mutating runs blocked";
  }

  if (safety.clean) {
    return "Clean - mutating runs allowed";
  }

  return "Clean state unavailable";
}

function formatRepositorySafetyBlockedReason(reason: string): string {
  switch (reason) {
    case "repository_dirty":
      return "Repository has uncommitted changes; mutating requirement runs are blocked.";
    case "repository_path_not_allowed":
      return "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS.";
    case "git_repository_required":
      return "Path is not a git repository.";
    case "committed_head_required":
      return "Repository needs an initial commit before mutating workflows.";
    case "git_status_unavailable":
      return "Git status is unavailable; repository safety cannot be verified.";
    default:
      return reason;
  }
}

function buildTicketBlockedReason(
  requirement: RequirementDeliveryTicket,
  hasRepository: boolean,
  executionStatus: WorkflowRun["status"]
): string | undefined {
  if (!hasRepository) {
    return "Repository path required before execution.";
  }

  if (executionStatus === "gate_failed") {
    return "Required gate failed; merge approval is blocked while evidence remains inspectable.";
  }

  if (executionStatus === "failed") {
    return "Workflow failed before merge approval evidence was produced.";
  }

  if (executionStatus === "aborted") {
    return "Workflow was canceled before delivery evidence was complete.";
  }

  return undefined;
}

function buildTicketRecoveryAction(
  requirement: RequirementDeliveryTicket,
  hasRepository: boolean
): string {
  if (!hasRepository) {
    return "Register or select a repository";
  }

  switch (requirement.status) {
    case "plan_review":
      return "Confirm plan";
    case "ready_to_run":
      return "Enqueue requirement";
    case "running":
      return "View current workflow";
    case "needs_rework":
      return "Retry workflow";
    default:
      return "Run repository preflight before mutating actions";
  }
}

function buildRepositorySafety(workflow: WorkflowRun): RepositorySafetySummary {
  const latestWorkspace = [...workflow.tasks]
    .reverse()
    .find((task) => task.workspace)?.workspace;
  const hasRepository = Boolean(workflow.repositoryPath);
  const blockedReason = buildRepositoryBlockedReason(workflow, hasRepository);

  return {
    repositoryLabel: workflow.repositoryPath ?? "No repository selected",
    executionModeLabel:
      workflow.executionMode === "worktree" || latestWorkspace
        ? "Isolated worktree"
        : "Direct repository",
    branchLabel: latestWorkspace?.branch ?? "Branch pending preflight",
    headLabel: "HEAD SHA not reported",
    cleanStateLabel: hasRepository
      ? workflow.status === "needs_review" ||
        workflow.status === "completed" ||
        workflow.status === "gate_failed"
        ? "Apply clean check required"
        : "Clean state pending preflight"
      : "No repository selected",
    allowedRootLabel: hasRepository
      ? hasWorkflowPreflightEvidence(workflow)
        ? "Allowed root accepted by API"
        : "Allowed root pending preflight"
      : "Allowed root not checked",
    mergePolicyLabel: noAutoMergePolicyLabel,
    blockedReason,
    recoveryAction: buildRepositoryRecoveryAction(workflow, hasRepository)
  };
}

function buildRepositoryBlockedReason(
  workflow: WorkflowRun,
  hasRepository: boolean
): string | undefined {
  if (!hasRepository) {
    return "Repository path required before execution.";
  }

  if (workflow.status === "gate_failed") {
    return "Required gate failed; merge approval is blocked while evidence remains inspectable.";
  }

  if (workflow.status === "failed") {
    return "Workflow failed before merge approval evidence was produced.";
  }

  if (workflow.status === "aborted") {
    return "Workflow was canceled before delivery evidence was complete.";
  }

  return undefined;
}

function hasWorkflowPreflightEvidence(workflow: WorkflowRun): boolean {
  return (
    workflow.status === "running" ||
    workflow.status === "gate_failed" ||
    workflow.status === "needs_review" ||
    workflow.status === "completed" ||
    workflow.status === "aborted" ||
    workflow.status === "archived" ||
    workflow.status === "failed"
  );
}

function hasRequirementPreflightEvidence(
  executionStatus: WorkflowRun["status"]
): boolean {
  return (
    executionStatus === "running" ||
    executionStatus === "gate_failed" ||
    executionStatus === "needs_review" ||
    executionStatus === "completed" ||
    executionStatus === "aborted" ||
    executionStatus === "archived" ||
    executionStatus === "failed"
  );
}

function buildRepositoryRecoveryAction(
  workflow: WorkflowRun,
  hasRepository: boolean
): string {
  if (!hasRepository) {
    return "Register or select a repository";
  }

  if (workflow.status === "gate_failed") {
    return "Retry failed gate";
  }

  if (workflow.status === "failed" || workflow.status === "aborted") {
    return "Retry workflow";
  }

  return "Run repository preflight before mutating actions";
}

export function mapWorkflowToRequirementSummary(
  workflow: WorkflowRun
): RequirementSummary {
  const workflowRunStatusLabel = formatWorkflowStatus(workflow.status);

  return {
    id: workflow.id,
    source: "workflow",
    title: workflow.goal,
    repositoryLabel: workflow.repositoryPath ?? "No repository selected",
    repositorySafety: buildRepositorySafety(workflow),
    requirementStage: statusStageMap[workflow.status],
    executionStatus: workflow.status,
    riskLevel: mapRiskLevel(workflow),
    nextAction: mapNextAction(workflow),
    nodeLabel: buildNodeLabel(workflow),
    updatedAt: workflow.updatedAt ?? workflow.createdAt ?? "Unknown",
    workflowRunHref: `/workflows/${workflow.id}`,
    workflowRunId: workflow.id,
    workflowRunStatus: workflow.status,
    workflowRunStatusLabel,
    qualityGateDefinitions: workflow.qualityGates.map((gate) => ({
      id: gate.id,
      title: gate.title,
      ...(gate.command ? { command: gate.command } : {}),
      required: true
    })),
    ...(workflow.review?.decision
      ? { reviewDecision: workflow.review.decision }
      : {}),
    availableActions: buildWorkflowAvailableActions(workflow)
  };
}

export function mapRequirementTicketToSummary(
  requirement: RequirementDeliveryTicket,
  workflowsById: Map<string, WorkflowRun> = new Map(),
  context: DeliveryConsoleModelContext = {}
): RequirementSummary {
  const latestRunLink = requirement.currentWorkflowRunId
    ? requirement.runLinks.find(
        (link) => link.workflowRunId === requirement.currentWorkflowRunId
      )
    : requirement.runLinks.at(-1);
  const workflowRunId =
    requirement.currentWorkflowRunId ?? latestRunLink?.workflowRunId;
  const workflow = workflowRunId ? workflowsById.get(workflowRunId) : undefined;
  const workflowStatus = workflow?.status ?? latestRunLink?.status;
  const executionStatus = mapRequirementExecutionStatus(
    requirement,
    workflowStatus
  );

  return {
    id: requirement.id,
    source: "requirement",
    title: requirement.title,
    repositoryLabel:
      requirement.repositoryPath ??
      requirement.repositoryId ??
      "No repository selected",
    repositorySafety: buildTicketRepositorySafety(
      requirement,
      executionStatus,
      workflow,
      requirement.repositoryId
        ? context.repositorySafetyByRepositoryId?.[requirement.repositoryId]
        : undefined
    ),
    requirementStage: requirement.status,
    executionStatus,
    riskLevel: mapRequirementRiskLevel(requirement, workflowStatus),
    nextAction: mapRequirementNextAction(requirement, workflowStatus),
    nodeLabel: buildRequirementNodeLabel(requirement),
    updatedAt: requirement.updatedAt,
    currentJobStatus: context.jobStatusByRequirementId?.[requirement.id],
    workflowRunHref: workflowRunId ? `/workflows/${workflowRunId}` : undefined,
    workflowRunId,
    workflowRunStatus: workflowStatus,
    workflowRunStatusLabel: workflowStatus
      ? formatWorkflowStatus(workflowStatus)
      : "No workflow run linked",
    qualityGateDefinitions: requirement.qualityGates.map((gate, index) => ({
      id: gate.id ?? `gate-${index + 1}`,
      title: gate.title ?? `Gate ${index + 1}`,
      command: gate.command,
      required: gate.required
    })),
    ...(workflow?.review?.decision
      ? { reviewDecision: workflow.review.decision }
      : {}),
    availableActions: buildRequirementAvailableActions(requirement)
  };
}

function buildWorkflowAvailableActions(
  workflow: WorkflowRun
): RequirementLifecycleAction[] {
  if (workflow.status === "ready") {
    return ["enqueue"];
  }

  if (
    workflow.status === "gate_failed" ||
    workflow.status === "failed" ||
    workflow.status === "aborted"
  ) {
    return ["retry"];
  }

  return [];
}

function buildRequirementAvailableActions(
  requirement: RequirementDeliveryTicket
): RequirementLifecycleAction[] {
  switch (requirement.status) {
    case "plan_review":
      return ["confirm-plan"];
    case "ready_to_run":
      return ["enqueue"];
    case "needs_rework":
      return requirement.currentWorkflowRunId ? ["retry"] : [];
    default:
      return [];
  }
}

function buildDecisionQueue(workflows: WorkflowRun[]): DeliveryDecisionItem[] {
  return workflows.flatMap((workflow): DeliveryDecisionItem[] => {
    if (workflow.status === "gate_failed") {
      return [
        {
          id: `${workflow.id}:retry`,
          requirementId: workflow.id,
          title: workflow.goal,
          actionLabel: "Retry failed gate",
          severity: "danger"
        }
      ];
    }

    if (workflow.status === "needs_review") {
      return [
        {
          id: `${workflow.id}:review`,
          requirementId: workflow.id,
          title: workflow.goal,
          actionLabel: "Review merge candidate",
          severity: "warning"
        }
      ];
    }

    return [];
  });
}

function buildRequirementDecisionQueue(
  requirements: RequirementSummary[]
): DeliveryDecisionItem[] {
  return requirements.flatMap((requirement): DeliveryDecisionItem[] => {
    if (requirement.requirementStage === "plan_review") {
      return [
        {
          id: `${requirement.id}:confirm-plan`,
          requirementId: requirement.id,
          title: requirement.title,
          actionLabel: "Confirm plan",
          severity: "info"
        }
      ];
    }

    if (requirement.requirementStage === "needs_rework") {
      return [
        {
          id: `${requirement.id}:retry`,
          requirementId: requirement.id,
          title: requirement.title,
          actionLabel: requirement.nextAction,
          severity: "danger"
        }
      ];
    }

    if (requirement.requirementStage === "needs_review") {
      return [
        {
          id: `${requirement.id}:review`,
          requirementId: requirement.id,
          title: requirement.title,
          actionLabel: "Review merge candidate",
          severity: "warning"
        }
      ];
    }

    return [];
  });
}

export function buildDeliveryConsoleModel(
  workflows: WorkflowRun[],
  now: Date = new Date(),
  requirementTickets: RequirementDeliveryTicket[] = [],
  context: DeliveryConsoleModelContext = {}
): DeliveryConsoleModel {
  const workflowsById = new Map(
    workflows.map((workflow) => [workflow.id, workflow] as const)
  );
  const requirements = requirementTickets.length
    ? requirementTickets.map((requirement) =>
        mapRequirementTicketToSummary(requirement, workflowsById, context)
      )
    : workflows.map(mapWorkflowToRequirementSummary);
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const usesRequirementTickets = requirementTickets.length > 0;

  return {
    requirements,
    kpis: {
      activeRequirements: requirements.filter(
        (requirement) => requirement.requirementStage !== "archived"
      ).length,
      needsClarification: requirements.filter(
        (requirement) => requirement.requirementStage === "needs_clarification"
      ).length,
      runningTasks: requirements.filter(
        (requirement) => requirement.requirementStage === "running"
      ).length,
      failedGates: requirements.filter(
        (requirement) => requirement.executionStatus === "gate_failed"
      ).length,
      waitingForReview: requirements.filter(
        (requirement) => requirement.requirementStage === "needs_review"
      ).length,
      deliveredLastSevenDays: usesRequirementTickets
        ? requirements.filter(
            (requirement) =>
              requirement.requirementStage === "delivered" &&
              updatedAtStringMs(requirement.updatedAt) >= sevenDaysAgo &&
              updatedAtStringMs(requirement.updatedAt) <= now.getTime()
          ).length
        : workflows.filter(
            (workflow) =>
              workflow.status === "completed" &&
              workflow.review?.decision === "approved" &&
              updatedAtMs(workflow) >= sevenDaysAgo &&
              updatedAtMs(workflow) <= now.getTime()
          ).length
    },
    decisionQueue: usesRequirementTickets
      ? buildRequirementDecisionQueue(requirements)
      : buildDecisionQueue(workflows)
  };
}

function updatedAtMs(workflow: WorkflowRun): number {
  const value = workflow.updatedAt ?? workflow.createdAt;

  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function updatedAtStringMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatWorkflowStatus(status: WorkflowStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready";
    case "running":
      return "Running";
    case "gate_failed":
      return "Gate failed";
    case "needs_review":
      return "Needs review";
    case "completed":
      return "Completed";
    case "aborted":
      return "Aborted";
    case "archived":
      return "Archived";
    case "failed":
      return "Failed";
  }
}
