import { z } from "zod";

export const taskStatusSchema = z.enum([
  "waiting",
  "running",
  "blocked",
  "passed",
  "failed",
  "canceled",
  "reviewing"
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
  "failed"
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
  metadata: z.record(z.string(), z.string()).optional()
});

export const worktreeWorkspaceSchema = z.object({
  path: z.string(),
  branch: z.string(),
  repoPath: z.string()
});

export const diffArtifactSchema = z.object({
  status: z.string(),
  patch: z.string()
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
  diff: diffArtifactSchema.optional()
});

export const qualityGateRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  command: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  result: shellRunResultSchema.optional()
});

export const workflowReviewRecordSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
  reviewedAt: z.string()
});

export const workflowRunSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: workflowStatusSchema,
  executionMode: z.enum(["direct", "worktree"]).optional(),
  repositoryPath: z.string().optional(),
  worktreeRoot: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  review: workflowReviewRecordSchema.optional(),
  tasks: z.array(taskRunSchema),
  qualityGates: z.array(qualityGateRunSchema).default([])
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
    dependsOn: z.array(z.string().min(1)).optional()
  })
  .refine((task) => task.command || task.instructions, {
    message: "Task requires command or instructions",
    path: ["command"]
  });

export const qualityGateInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  cwd: z.string().min(1).optional()
});

export const repositoryRegistrationRequestSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  defaultBranch: z.string().min(1).optional(),
  qualityGates: z.array(qualityGateInputSchema).default([])
});

export const repositoryRecordSchema = repositoryRegistrationRequestSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createRepositoryWorkflowRequestSchema = z
  .object({
    goal: z.string().min(1),
    repositoryId: z.string().min(1).optional(),
    repositoryPath: z.string().min(1).optional(),
    worktreeRoot: z.string().min(1).optional(),
    tasks: z.array(workflowTaskInputSchema).min(1),
    qualityGates: z.array(qualityGateInputSchema).default([])
  })
  .refine((request) => request.repositoryId || request.repositoryPath, {
    message: "Repository workflow requires repositoryId or repositoryPath",
    path: ["repositoryPath"]
  });

export const agentSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
});

export const agentHealthSchema = agentSummarySchema.extend({
  configured: z.boolean(),
  healthy: z.boolean(),
  status: z.enum(["healthy", "missing_command", "auth_unchecked", "auth_failed"]),
  message: z.string(),
  command: z.string().optional(),
  authProbeConfigured: z.boolean().optional(),
  checkedAt: z.string()
});

export const workflowReviewRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().min(1).optional()
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
  createdAt: z.string()
});

export const workspaceCleanupItemSchema = z.object({
  taskId: z.string(),
  path: z.string(),
  branch: z.string()
});

export const workspaceCleanupResultSchema = z.object({
  workflowId: z.string(),
  status: z.enum(["cleaned", "empty"]),
  cleanedAt: z.string(),
  cleaned: z.array(workspaceCleanupItemSchema)
});

export const runReportSchema = z.object({
  workflowId: z.string(),
  reportArtifactPath: z.string().optional(),
  summary: z.string(),
  recommendation: z.enum([
    "ready_for_review",
    "fix_failed_tasks",
    "fix_failed_gates"
  ]),
  failedTasks: z.array(z.string()),
  failedGates: z.array(z.string()),
  taskResults: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: taskStatusSchema,
    agentId: z.string().optional(),
    agentLabel: z.string().optional(),
    promptFile: z.string().optional(),
    exitCode: z.number().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    workspacePath: z.string().optional(),
    branch: z.string().optional(),
    gitStatus: z.string().optional(),
    patch: z.string().optional(),
    stdoutArtifactPath: z.string().optional(),
    stderrArtifactPath: z.string().optional(),
    gitStatusArtifactPath: z.string().optional(),
    patchArtifactPath: z.string().optional()
  })),
  gateResults: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: taskStatusSchema,
    exitCode: z.number().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    stdoutArtifactPath: z.string().optional(),
    stderrArtifactPath: z.string().optional()
  }))
});

export const workflowJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "canceled"
]);

export const workflowJobSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: workflowJobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional()
});

export const auditEventTypeSchema = z.enum([
  "repository.registered",
  "workflow.created",
  "workflow.enqueued",
  "workflow.retry_requested",
  "workflow.reviewed",
  "workflow.workspaces_cleaned",
  "workflow.task_started",
  "workflow.task_completed",
  "workflow.gate_started",
  "workflow.gate_completed",
  "job.recovered",
  "job.canceled"
]);

export const auditEventSchema = z.object({
  id: z.string(),
  type: auditEventTypeSchema,
  createdAt: z.string(),
  actor: z.string().optional(),
  workflowId: z.string().optional(),
  jobId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional()
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
export type RepositoryRegistrationRequest = z.infer<
  typeof repositoryRegistrationRequestSchema
>;
export type RepositoryRecord = z.infer<typeof repositoryRecordSchema>;
export type CreateRepositoryWorkflowRequest = z.infer<
  typeof createRepositoryWorkflowRequestSchema
>;
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentHealth = z.infer<typeof agentHealthSchema>;
export type WorkflowReviewRequest = z.infer<
  typeof workflowReviewRequestSchema
>;
export type MergeCandidate = z.infer<typeof mergeCandidateSchema>;
export type WorkspaceCleanupResult = z.infer<
  typeof workspaceCleanupResultSchema
>;
