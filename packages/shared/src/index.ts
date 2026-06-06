import { z } from "zod";

export const taskStatusSchema = z.enum([
  "waiting",
  "running",
  "blocked",
  "passed",
  "failed",
  "canceled",
  "reviewing",
]);

export const workflowStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "gate_failed",
  "needs_review",
  "completed",
  "aborted",
  "archived",
  "failed",
]);

export const shellRunResultSchema = z.object({
  command: z.string().optional(),
  status: z.enum(["passed", "failed", "canceled"]).optional(),
  exitCode: z.number(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  durationMs: z.number().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const worktreeWorkspaceSchema = z.object({
  path: z.string(),
  branch: z.string(),
  repoPath: z.string(),
});

export const diffArtifactSchema = z.object({
  status: z.string(),
  patch: z.string(),
});

export const taskRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  agent: z.string().optional(),
  command: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  dependsOn: z.array(z.string()).optional(),
  result: shellRunResultSchema.optional(),
  workspace: worktreeWorkspaceSchema.optional(),
  diff: diffArtifactSchema.optional(),
});

export const qualityGateRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  required: z.boolean().default(true),
  command: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  result: shellRunResultSchema.optional(),
});

export const workflowReviewRecordSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
  reviewedAt: z.string(),
});

export const workflowRunSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: workflowStatusSchema,
  executionMode: z.enum(["direct", "worktree"]).optional(),
  repositoryId: z.string().optional(),
  repositoryPath: z.string().optional(),
  worktreeRoot: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  review: workflowReviewRecordSchema.optional(),
  tasks: z.array(taskRunSchema),
  qualityGates: z.array(qualityGateRunSchema).default([]),
});

export const workflowTaskInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    agent: z.string().min(1).default("shell"),
    command: z.string().min(1).optional(),
    instructions: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
  })
  .refine((task) => task.command || task.instructions, {
    message: "Task requires command or instructions",
    path: ["command"],
  });

export const qualityGateInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  command: z.string().min(1),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().positive().optional(),
  cwd: z.string().min(1).optional(),
});

export const requirementStatusSchema = z.enum([
  "draft",
  "needs_clarification",
  "plan_review",
  "ready_to_run",
  "running",
  "needs_review",
  "delivered",
  "needs_rework",
  "archived",
]);

export const requirementRiskLevelSchema = z.enum(["low", "medium", "high"]);

export const requirementRunLinkSchema = z.object({
  workflowRunId: z.string().min(1),
  status: workflowStatusSchema.optional(),
  linkedAt: z.string(),
});

export const requirementQualityGateInputSchema = qualityGateInputSchema.extend({
  required: z.boolean().default(true),
});

const requirementStringListSchema = z.array(z.string().min(1));

export const createRequirementDeliveryTicketRequestSchema = z.object({
  title: z.string().min(1),
  repositoryId: z.string().min(1).optional(),
  repositoryPath: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  acceptanceCriteria: requirementStringListSchema.default([]),
  constraints: requirementStringListSchema.default([]),
  nonGoals: requirementStringListSchema.default([]),
  riskLevel: requirementRiskLevelSchema.default("medium"),
  contextPaths: requirementStringListSchema.default([]),
  tasks: z.array(workflowTaskInputSchema).max(5).default([]),
  qualityGates: z.array(requirementQualityGateInputSchema).default([]),
});

export const updateRequirementDeliveryTicketRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    repositoryId: z.string().min(1).optional(),
    repositoryPath: z.string().min(1).optional(),
    goal: z.string().min(1).optional(),
    acceptanceCriteria: requirementStringListSchema.optional(),
    constraints: requirementStringListSchema.optional(),
    nonGoals: requirementStringListSchema.optional(),
    riskLevel: requirementRiskLevelSchema.optional(),
    contextPaths: requirementStringListSchema.optional(),
    tasks: z.array(workflowTaskInputSchema).max(5).optional(),
    qualityGates: z.array(requirementQualityGateInputSchema).optional(),
    currentWorkflowRunId: z.string().min(1).optional(),
    runLinks: z.array(requirementRunLinkSchema).optional(),
  })
  .refine((request) => Object.keys(request).length > 0, {
    message: "Requirement update requires at least one field",
  });

export const requirementDeliveryTicketSchema = z.object({
  id: z.string(),
  title: z.string(),
  repositoryId: z.string().optional(),
  repositoryPath: z.string().optional(),
  goal: z.string(),
  acceptanceCriteria: requirementStringListSchema.default([]),
  constraints: requirementStringListSchema.default([]),
  nonGoals: requirementStringListSchema.default([]),
  riskLevel: requirementRiskLevelSchema,
  contextPaths: requirementStringListSchema.default([]),
  tasks: z.array(workflowTaskInputSchema).max(5).default([]),
  qualityGates: z.array(requirementQualityGateInputSchema).default([]),
  status: requirementStatusSchema,
  currentWorkflowRunId: z.string().optional(),
  runLinks: z.array(requirementRunLinkSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const decisionQueueItemSchema = z.object({
  id: z.string().min(1),
  requirementId: z.string().min(1),
  title: z.string().min(1),
  actionLabel: z.string().min(1),
  severity: z.enum(["info", "warning", "danger"]),
});

export const repositoryRegistrationRequestSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  qualityGates: z.array(qualityGateInputSchema).default([]),
});

export const repositoryRecordSchema =
  repositoryRegistrationRequestSchema.extend({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

export const repositorySafetySchema = z.object({
  repositoryId: z.string(),
  path: z.string(),
  defaultBranch: z.string().min(1).optional(),
  currentBranch: z.string().min(1).optional(),
  headShortSha: z.string().min(1).optional(),
  clean: z.boolean(),
  dirty: z.boolean(),
  allowedRoot: z.boolean(),
  blockedReason: z.string().min(1).optional(),
  recoveryAction: z.string().min(1).optional(),
  noAutoMerge: z.literal(true),
  manualApplyPolicy: z.string().min(1),
});

export const createRepositoryWorkflowRequestSchema = z
  .object({
    goal: z.string().min(1),
    repositoryId: z.string().min(1).optional(),
    repositoryPath: z.string().min(1).optional(),
    worktreeRoot: z.string().min(1).optional(),
    tasks: z.array(workflowTaskInputSchema).min(1),
    qualityGates: z.array(qualityGateInputSchema).default([]),
  })
  .refine((request) => request.repositoryId || request.repositoryPath, {
    message: "Repository workflow requires repositoryId or repositoryPath",
    path: ["repositoryPath"],
  });

export const agentSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const agentHealthSchema = agentSummarySchema.extend({
  configured: z.boolean(),
  healthy: z.boolean(),
  status: z.enum([
    "healthy",
    "missing_command",
    "auth_unchecked",
    "auth_failed",
  ]),
  message: z.string(),
  command: z.string().optional(),
  authProbeConfigured: z.boolean().optional(),
  checkedAt: z.string(),
});

export const readinessCheckSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    ok: z.boolean(),
    status: z.enum(["ready", "degraded", "blocked", "failed"]),
    message: z.string().optional(),
    missing: z.array(z.string()).optional(),
  })
  .passthrough();

export const readinessResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string().min(1),
  checkedAt: z.string(),
  deploymentMode: z.enum(["development", "production"]),
  protectedByToken: z.boolean(),
  root: z.string(),
  activeJobs: z.number().int().nonnegative(),
  checks: z.array(readinessCheckSchema),
});

export const workerHealthSchema = z.object({
  workerId: z.string().min(1),
  healthy: z.boolean(),
  status: z.string().min(1),
  lastSeenAt: z.string(),
  ageMs: z.number().nonnegative(),
  workflowId: z.string().optional(),
  jobId: z.string().optional(),
  lastJobStatus: z.string().optional(),
});

export const workerHealthResponseSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  staleAfterMs: z.number().positive(),
  summary: z.object({
    totalWorkers: z.number().int().nonnegative(),
    healthyWorkers: z.number().int().nonnegative(),
    staleWorkers: z.number().int().nonnegative(),
  }),
  workers: z.array(workerHealthSchema),
});

export const workflowReviewRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().min(1).optional(),
});

export const mergeCandidateSchema = z.object({
  workflowId: z.string(),
  status: z.enum(["ready", "empty"]),
  summary: z.string(),
  sourceBranches: z.array(z.string()),
  patch: z.string(),
  patchArtifactPath: z.string().optional(),
  manifestArtifactPath: z.string().optional(),
  applyCommand: z.string().optional(),
  createdAt: z.string(),
});

export const mergeCandidateApplyResultSchema = z.object({
  workflowId: z.string(),
  status: z.enum(["applied"]),
  repositoryPath: z.string(),
  sourceBranches: z.array(z.string()),
  patchArtifactPath: z.string().optional(),
  gitStatus: z.string(),
  appliedAt: z.string(),
});

export const workspaceCleanupItemSchema = z.object({
  taskId: z.string(),
  path: z.string(),
  branch: z.string(),
});

export const workspaceCleanupResultSchema = z.object({
  workflowId: z.string(),
  status: z.enum(["cleaned", "empty"]),
  cleanedAt: z.string(),
  cleaned: z.array(workspaceCleanupItemSchema),
});

export const workspaceCleanupPreviewItemSchema = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  path: z.string(),
  branch: z.string(),
  repoPath: z.string(),
  exists: z.boolean(),
  cleanupAllowed: z.boolean(),
});

export const workspaceCleanupPreviewSchema = z.object({
  workflowId: z.string(),
  workflowStatus: workflowStatusSchema,
  cleanupAllowed: z.boolean(),
  blockedReason: z.string().optional(),
  workspaceCount: z.number().int().nonnegative(),
  existingCount: z.number().int().nonnegative(),
  workspaces: z.array(workspaceCleanupPreviewItemSchema),
});

export const runReportSchema = z.object({
  workflowId: z.string(),
  reportArtifactPath: z.string().optional(),
  summary: z.string(),
  recommendation: z.enum([
    "ready_for_review",
    "fix_failed_tasks",
    "fix_failed_gates",
  ]),
  failedTasks: z.array(z.string()),
  failedGates: z.array(z.string()),
  taskResults: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: taskStatusSchema,
      agentId: z.string().optional(),
      agentLabel: z.string().optional(),
      promptFile: z.string().optional(),
      exitCode: z.number().optional(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      durationMs: z.number().optional(),
      workspacePath: z.string().optional(),
      branch: z.string().optional(),
      gitStatus: z.string().optional(),
      patch: z.string().optional(),
      stdoutArtifactPath: z.string().optional(),
      stderrArtifactPath: z.string().optional(),
      gitStatusArtifactPath: z.string().optional(),
      patchArtifactPath: z.string().optional(),
    }),
  ),
  gateResults: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: taskStatusSchema,
      required: z.boolean().default(true),
      exitCode: z.number().optional(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      durationMs: z.number().optional(),
      stdoutArtifactPath: z.string().optional(),
      stderrArtifactPath: z.string().optional(),
    }),
  ),
});

export const workflowJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);

export const workflowJobSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: workflowJobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
});

export const auditEventTypeSchema = z.enum([
  "repository.registered",
  "repository.updated",
  "repository.deleted",
  "workflow.created",
  "workflow.enqueued",
  "workflow.retry_requested",
  "workflow.reviewed",
  "workflow.artifact_read",
  "workflow.merge_candidate_applied",
  "workflow.workspaces_cleaned",
  "workflow.task_started",
  "workflow.task_completed",
  "workflow.gate_started",
  "workflow.gate_completed",
  "worker.heartbeat",
  "job.recovered",
  "job.claimed",
  "job.completed",
  "job.failed",
  "job.lease_lost",
  "job.canceled",
]);

export const auditEventSchema = z.object({
  id: z.string(),
  type: auditEventTypeSchema,
  createdAt: z.string(),
  actor: z.string().optional(),
  workflowId: z.string().optional(),
  jobId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const operationsSnapshotSchema = z.object({
  checkedAt: z.string(),
  repositoryId: z.string().optional(),
  summary: z.object({
    queuedJobs: z.number().int().nonnegative(),
    runningJobs: z.number().int().nonnegative(),
    activeJobs: z.number().int().nonnegative(),
    failedJobs: z.number().int().nonnegative(),
    needsReviewWorkflows: z.number().int().nonnegative(),
    blockedReadinessChecks: z.number().int().nonnegative(),
    healthyWorkers: z.number().int().nonnegative(),
    totalWorkers: z.number().int().nonnegative(),
  }),
  auditEvents: z.array(auditEventSchema),
  jobs: z.array(workflowJobSchema),
  readiness: readinessResponseSchema,
  workerHealth: workerHealthResponseSchema,
});

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type WorkflowJobStatus = z.infer<typeof workflowJobStatusSchema>;
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type ShellRunResult = z.infer<typeof shellRunResultSchema>;
export type WorktreeWorkspace = z.infer<typeof worktreeWorkspaceSchema>;
export type DiffArtifact = z.infer<typeof diffArtifactSchema>;
export type TaskRun = z.infer<typeof taskRunSchema>;
export type QualityGateRun = z.infer<typeof qualityGateRunSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowReviewRecord = z.infer<typeof workflowReviewRecordSchema>;
export type RunReport = z.infer<typeof runReportSchema>;
export type WorkflowJob = z.infer<typeof workflowJobSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type WorkflowTaskInput = z.infer<typeof workflowTaskInputSchema>;
export type QualityGateInput = z.infer<typeof qualityGateInputSchema>;
export type RequirementStatus = z.infer<typeof requirementStatusSchema>;
export type RequirementRiskLevel = z.infer<typeof requirementRiskLevelSchema>;
export type RequirementRunLink = z.infer<typeof requirementRunLinkSchema>;
export type RequirementQualityGateInput = z.infer<
  typeof requirementQualityGateInputSchema
>;
export type CreateRequirementDeliveryTicketRequest = z.input<
  typeof createRequirementDeliveryTicketRequestSchema
>;
export type UpdateRequirementDeliveryTicketRequest = z.input<
  typeof updateRequirementDeliveryTicketRequestSchema
>;
export type RequirementDeliveryTicket = z.infer<
  typeof requirementDeliveryTicketSchema
>;
export type DecisionQueueItem = z.infer<typeof decisionQueueItemSchema>;
export type RepositoryRegistrationRequest = z.infer<
  typeof repositoryRegistrationRequestSchema
>;
export type RepositoryRecord = z.infer<typeof repositoryRecordSchema>;
export type RepositorySafety = z.infer<typeof repositorySafetySchema>;
export type CreateRepositoryWorkflowRequest = z.infer<
  typeof createRepositoryWorkflowRequestSchema
>;
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentHealth = z.infer<typeof agentHealthSchema>;
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type WorkerHealth = z.infer<typeof workerHealthSchema>;
export type WorkerHealthResponse = z.infer<typeof workerHealthResponseSchema>;
export type OperationsSnapshot = z.infer<typeof operationsSnapshotSchema>;
export type WorkflowReviewRequest = z.infer<typeof workflowReviewRequestSchema>;
export type MergeCandidate = z.infer<typeof mergeCandidateSchema>;
export type MergeCandidateApplyResult = z.infer<
  typeof mergeCandidateApplyResultSchema
>;
export type WorkspaceCleanupResult = z.infer<
  typeof workspaceCleanupResultSchema
>;
export type WorkspaceCleanupPreview = z.infer<
  typeof workspaceCleanupPreviewSchema
>;
