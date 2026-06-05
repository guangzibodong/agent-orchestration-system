import cors from "@fastify/cors";
import {
  auditEventTypeSchema,
  createRepositoryWorkflowRequestSchema,
  repositoryRegistrationRequestSchema,
  workflowJobStatusSchema,
  workflowStatusSchema,
  workflowReviewRequestSchema
} from "@mawo/shared";
import Fastify from "fastify";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync
} from "node:fs";
import { resolve, sep, join, isAbsolute } from "node:path";
import { FileArtifactStore } from "./runner/file-artifact-store.js";
import { FileAuditStore, type AuditStore } from "./runner/file-audit-store.js";
import { FileJobStore, type JobStore } from "./runner/file-job-store.js";
import {
  FileRepositoryStore,
  type RepositoryStore
} from "./runner/file-repository-store.js";
import { FileRunStore } from "./runner/file-run-store.js";
import {
  createAgentHealthChecks,
  createAgentSummaries,
  createConfiguredAgentConfigs
} from "./runner/agent-config.js";
import {
  createDemoWorkflowDefinition,
  LocalRunner,
  WorkflowNotRetryableError,
  WorkflowNotReviewReadyError,
  WorkflowWorkspacesNotCleanableError
} from "./runner/local-runner.js";
import {
  createAgentDemoWorkflowDefinition,
  createWorktreeDemoWorkflowDefinition
} from "./runner/demo-repository.js";
import {
  createRepositoryWorkflowDefinition,
  RepositoryNotReadyError
} from "./runner/repository-workflow.js";
import {
  WorkflowAlreadyRunningError,
  WorkflowJobQueue
} from "./runner/workflow-job-queue.js";

export type BuildAppOptions = {
  demoRoot?: string;
  env?: Record<string, string | undefined>;
  auditStore?: AuditStore;
  jobStore?: JobStore;
  repositoryStore?: RepositoryStore;
};

const JOB_TIMELINE_WORKFLOW_EVENT_TYPES = new Set([
  "workflow.task_started",
  "workflow.task_completed",
  "workflow.gate_started",
  "workflow.gate_completed"
]);

export function buildApp(runner?: LocalRunner, options: BuildAppOptions = {}) {
  const root = options.demoRoot ?? process.cwd();
  const stateRoot = join(root, ".mawo", "state");
  const artifactRoot = join(root, ".mawo", "artifacts");
  const env = options.env ?? process.env;
  const apiToken = env.MAWO_API_TOKEN?.trim();
  const allowedRepositoryRoots = parseAllowedRepositoryRoots(
    env.MAWO_ALLOWED_REPOSITORY_ROOTS
  );
  const cliAgents = createConfiguredAgentConfigs(env);
  const auditStore =
    options.auditStore ??
    new FileAuditStore({
      stateFile: join(root, ".mawo", "state", "audit-events.json")
    });
  const activeRunner =
    runner ??
    new LocalRunner(undefined, {
      cliAgents,
      runStore: new FileRunStore({
        stateFile: join(stateRoot, "workflows.json")
      }),
      artifactStore: new FileArtifactStore({
        root: artifactRoot
      }),
      eventSink: (event) => {
        auditStore.append({
          type: event.type,
          actor: "runner",
          workflowId: event.workflowId,
          metadata: {
            ...(event.taskId ? { taskId: event.taskId } : {}),
            ...(event.gateId ? { gateId: event.gateId } : {}),
            ...(event.status ? { status: event.status } : {}),
            ...(event.exitCode !== undefined
              ? { exitCode: String(event.exitCode) }
              : {}),
            ...(event.durationMs !== undefined
              ? { durationMs: String(event.durationMs) }
              : {})
          }
        });
      }
    });
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test"
  });
  const queue = new WorkflowJobQueue({
    runner: activeRunner,
    jobStore:
      options.jobStore ??
      new FileJobStore({
        stateFile: join(stateRoot, "jobs.json")
      }),
    onJobRecovered: ({ original, recovered }) => {
      const workflowRecovery = activeRunner.recoverInterruptedWorkflow(
        recovered.workflowId
      );
      auditStore.append({
        type: "job.recovered",
        actor: "system",
        workflowId: recovered.workflowId,
        jobId: recovered.id,
        metadata: {
          previousStatus: original.status,
          recoveredStatus: recovered.status,
          error: recovered.error ?? "",
          workflowRecovered: String(workflowRecovery.recovered),
          previousWorkflowStatus: workflowRecovery.previousStatus ?? "",
          recoveredWorkflowStatus: workflowRecovery.status ?? "",
          recoveredTaskIds: workflowRecovery.recoveredTasks.join(","),
          recoveredGateIds: workflowRecovery.recoveredGates.join(",")
        }
      });
    }
  });
  const repositoryStore =
    options.repositoryStore ??
    new FileRepositoryStore({
      stateFile: join(stateRoot, "repositories.json")
    });

  app.register(cors, {
    origin: true
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!apiToken || request.method === "OPTIONS" || request.url === "/health") {
      return;
    }

    const authorization = request.headers.authorization ?? "";
    if (authorization === `Bearer ${apiToken}`) {
      return;
    }

    return reply
      .code(401)
      .header("www-authenticate", "Bearer")
      .send({ error: "unauthorized" });
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "mawo-api"
    };
  });

  app.get("/readiness", async () => {
    const checkedAt = new Date().toISOString();
    const storeChecks = [
      createWritableDirectoryCheck("state_store", "State store", stateRoot),
      createWritableDirectoryCheck(
        "artifact_store",
        "Artifact store",
        artifactRoot
      )
    ];
    const gitCheck = createGitCliCheck();
    const agentHealth = await createAgentHealthChecks(cliAgents);
    const healthyAgents = agentHealth.filter((agent) => agent.healthy).length;
    const agentsCheck = {
      id: "agents",
      label: "Agent health",
      ok: healthyAgents === agentHealth.length,
      status: healthyAgents === agentHealth.length ? "ready" : "degraded",
      healthyAgents,
      totalAgents: agentHealth.length,
      degradedAgents: agentHealth
        .filter((agent) => !agent.healthy)
        .map((agent) => ({
          id: agent.id,
          status: agent.status,
          message: agent.message,
          command: agent.command
        }))
    };
    const activeJobs = queue
      .listJobs()
      .filter((job) => job.status === "queued" || job.status === "running")
      .length;
    const checks = [...storeChecks, gitCheck, agentsCheck];

    return {
      ok: checks.every((check) => check.ok),
      service: "mawo-api",
      checkedAt,
      protectedByToken: Boolean(apiToken),
      root,
      activeJobs,
      checks
    };
  });

  app.get("/agents", async () => {
    return createAgentSummaries(cliAgents);
  });

  app.get("/agents/health", async () => {
    return createAgentHealthChecks(cliAgents);
  });

  app.get<{
    Querystring: {
      limit?: string;
      repositoryId?: string;
      repositoryPath?: string;
      status?: string;
    };
  }>("/workflows", async (request, reply) => {
    const workflowStatus = request.query.status
      ? workflowStatusSchema.safeParse(request.query.status)
      : undefined;

    if (workflowStatus && !workflowStatus.success) {
      return reply.code(400).send({
        error: "invalid_workflow_status",
        allowedStatuses: workflowStatusSchema.options
      });
    }

    const repositoryPath = request.query.repositoryPath
      ? resolve(request.query.repositoryPath)
      : undefined;
    const workflows = activeRunner.listWorkflows().filter((workflow) => {
      if (workflowStatus?.data && workflow.status !== workflowStatus.data) {
        return false;
      }

      if (
        request.query.repositoryId &&
        workflow.repositoryId !== request.query.repositoryId
      ) {
        return false;
      }

      if (
        repositoryPath &&
        (!workflow.repositoryPath ||
          resolve(workflow.repositoryPath) !== repositoryPath)
      ) {
        return false;
      }

      return true;
    });

    return limitToRecent(workflows, request.query.limit);
  });

  app.get<{
    Querystring: {
      actor?: string;
      jobId?: string;
      limit?: string;
      repositoryId?: string;
      type?: string;
      workflowId?: string;
    };
  }>("/audit-events", async (request, reply) => {
    const eventType = request.query.type
      ? auditEventTypeSchema.safeParse(request.query.type)
      : undefined;

    if (eventType && !eventType.success) {
      return reply.code(400).send({
        error: "invalid_audit_event_type",
        allowedTypes: auditEventTypeSchema.options
      });
    }

    const events = auditStore.list({
      actor: request.query.actor,
      jobId: request.query.jobId,
      repositoryId: request.query.repositoryId,
      type: eventType?.data,
      workflowId: request.query.workflowId
    });
    return limitToRecent(events, request.query.limit);
  });

  app.get("/repositories", async () => {
    return repositoryStore.list();
  });

  app.post("/repositories", async (request, reply) => {
    const parsed = repositoryRegistrationRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_repository_registration_request",
        issues: parsed.error.issues
      });
    }

    try {
      if (!isRepositoryPathAllowed(parsed.data.path, allowedRepositoryRoots)) {
        return reply.code(403).send({
          error: "repository_path_not_allowed",
          message: "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS."
        });
      }

      await createRepositoryWorkflowDefinition(
        {
          goal: "Validate repository registration",
          repositoryPath: parsed.data.path,
          tasks: [
            {
              id: "validate",
              agent: "shell",
              command: "git status --short"
            }
          ],
          qualityGates: []
        },
        { root }
      );
      const result = repositoryStore.upsert(parsed.data);
      const repository = result.repository;
      auditStore.append({
        type: result.created ? "repository.registered" : "repository.updated",
        actor: "operator",
        metadata: {
          repositoryId: repository.id,
          ...(result.previous
            ? { previousRepositoryName: result.previous.name }
            : {}),
          repositoryName: repository.name,
          repositoryPath: repository.path,
          defaultBranch: repository.defaultBranch ?? "",
          qualityGates: String(repository.qualityGates.length)
        }
      });

      return reply.code(result.created ? 201 : 200).send(repository);
    } catch (error) {
      if (error instanceof RepositoryNotReadyError) {
        return reply.code(422).send({
          error: "repository_not_ready",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.delete<{
    Params: { id: string };
  }>("/repositories/:id", async (request, reply) => {
    const repository = repositoryStore.remove(request.params.id);

    if (!repository) {
      return reply.code(404).send({ error: "repository_not_found" });
    }

    auditStore.append({
      type: "repository.deleted",
      actor: "operator",
      metadata: {
        repositoryId: repository.id,
        repositoryName: repository.name,
        repositoryPath: repository.path,
        defaultBranch: repository.defaultBranch ?? "",
        qualityGates: String(repository.qualityGates.length)
      }
    });

    return repository;
  });

  app.post("/workflows/demo", async (_request, reply) => {
    const run = activeRunner.createWorkflow(createDemoWorkflowDefinition());

    auditStore.append({
      type: "workflow.created",
      actor: "operator",
      workflowId: run.id,
      metadata: {
        source: "demo"
      }
    });

    return reply.code(201).send(run);
  });

  app.post("/workflows/worktree-demo", async (_request, reply) => {
    const definition = await createWorktreeDemoWorkflowDefinition(options.demoRoot);
    const run = activeRunner.createWorkflow(definition);

    auditStore.append({
      type: "workflow.created",
      actor: "operator",
      workflowId: run.id,
      metadata: {
        source: "worktree-demo"
      }
    });

    return reply.code(201).send(run);
  });

  app.post("/workflows/agent-demo", async (_request, reply) => {
    const definition = await createAgentDemoWorkflowDefinition(options.demoRoot);
    const run = activeRunner.createWorkflow(definition);

    auditStore.append({
      type: "workflow.created",
      actor: "operator",
      workflowId: run.id,
      metadata: {
        source: "agent-demo"
      }
    });

    return reply.code(201).send(run);
  });

  app.post("/workflows/repository", async (request, reply) => {
    const parsed = createRepositoryWorkflowRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_repository_workflow_request",
        issues: parsed.error.issues
      });
    }

    try {
      const repository = parsed.data.repositoryId
        ? repositoryStore.get(parsed.data.repositoryId)
        : undefined;

      if (parsed.data.repositoryId && !repository) {
        return reply.code(404).send({ error: "repository_not_found" });
      }

      const repositoryPath = repository?.path ?? parsed.data.repositoryPath;
      if (!repositoryPath) {
        return reply.code(400).send({
          error: "repository_path_required"
        });
      }

      if (!isRepositoryPathAllowed(repositoryPath, allowedRepositoryRoots)) {
        return reply.code(403).send({
          error: "repository_path_not_allowed",
          message: "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS."
        });
      }

      const definition = await createRepositoryWorkflowDefinition(
        {
          ...parsed.data,
          repositoryPath,
          qualityGates:
            parsed.data.qualityGates.length > 0
              ? parsed.data.qualityGates
              : repository?.qualityGates ?? []
        },
        {
        root
        }
      );
      const run = activeRunner.createWorkflow(definition);

      auditStore.append({
        type: "workflow.created",
        actor: "operator",
        workflowId: run.id,
        metadata: {
          source: "repository",
          repositoryId: run.repositoryId ?? "",
          repositoryPath: run.repositoryPath ?? ""
        }
      });

      return reply.code(201).send(run);
    } catch (error) {
      if (error instanceof RepositoryNotReadyError) {
        return reply.code(422).send({
          error: "repository_not_ready",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post<{
    Params: { id: string };
  }>("/workflows/:id/review", async (request, reply) => {
    const parsed = workflowReviewRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_workflow_review_request",
        issues: parsed.error.issues
      });
    }

    if (!activeRunner.getWorkflow(request.params.id)) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    try {
      const run = activeRunner.reviewWorkflow(request.params.id, parsed.data);

      auditStore.append({
        type: "workflow.reviewed",
        actor: "operator",
        workflowId: run.id,
        metadata: {
          decision: run.review?.decision ?? parsed.data.decision
        }
      });

      return run;
    } catch (error) {
      if (error instanceof WorkflowNotReviewReadyError) {
        return reply.code(409).send({
          error: "workflow_not_review_ready",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.get<{
    Params: { id: string };
  }>("/workflows/:id/workspaces", async (request, reply) => {
    if (!activeRunner.getWorkflow(request.params.id)) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    return activeRunner.getWorkspaceCleanupPreview(request.params.id);
  });

  app.post<{
    Params: { id: string };
  }>("/workflows/:id/workspaces/cleanup", async (request, reply) => {
    if (!activeRunner.getWorkflow(request.params.id)) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    try {
      const cleanup = await activeRunner.cleanupWorkflowWorkspaces(
        request.params.id
      );

      auditStore.append({
        type: "workflow.workspaces_cleaned",
        actor: "operator",
        workflowId: cleanup.workflowId,
        metadata: {
          status: cleanup.status,
          cleanedCount: String(cleanup.cleaned.length),
          cleanedTaskIds: cleanup.cleaned.map((item) => item.taskId).join(","),
          cleanedBranches: cleanup.cleaned.map((item) => item.branch).join(","),
          cleanedPaths: cleanup.cleaned.map((item) => item.path).join(",")
        }
      });

      return cleanup;
    } catch (error) {
      if (error instanceof WorkflowWorkspacesNotCleanableError) {
        return reply.code(409).send({
          error: "workflow_workspaces_not_cleanable",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.get<{
    Params: { id: string };
  }>("/workflows/:id", async (request, reply) => {
    const run = activeRunner.getWorkflow(request.params.id);

    if (!run) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    return run;
  });

  app.post<{
    Params: { id: string };
  }>("/workflows/:id/run", async (request, reply) => {
    try {
      return await activeRunner.runWorkflow(request.params.id);
    } catch {
      return reply.code(404).send({ error: "workflow_not_found" });
    }
  });

  app.post<{
    Params: { id: string };
  }>("/workflows/:id/retry", async (request, reply) => {
    if (!activeRunner.getWorkflow(request.params.id)) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    try {
      const run = activeRunner.retryWorkflow(request.params.id);

      auditStore.append({
        type: "workflow.retry_requested",
        actor: "operator",
        workflowId: run.id,
        metadata: {
          status: run.status
        }
      });

      return run;
    } catch (error) {
      if (error instanceof WorkflowNotRetryableError) {
        return reply.code(409).send({
          error: "workflow_not_retryable",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post<{
    Params: { id: string };
  }>("/workflows/:id/enqueue", async (request, reply) => {
    const workflow = activeRunner.getWorkflow(request.params.id);
    if (!workflow) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    try {
      const job = queue.enqueue(request.params.id);

      auditStore.append({
        type: "workflow.enqueued",
        actor: "operator",
        workflowId: job.workflowId,
        jobId: job.id,
        metadata: {
          repositoryId: workflow.repositoryId ?? "",
          repositoryPath: workflow.repositoryPath ?? "",
          status: job.status
        }
      });

      return reply.code(202).send(job);
    } catch (error) {
      if (error instanceof WorkflowAlreadyRunningError) {
        return reply.code(409).send({
          error: "workflow_already_running",
          message: error.message,
          job: error.job
        });
      }

      throw error;
    }
  });

  app.get<{
    Querystring: {
      limit?: string;
      repositoryId?: string;
      status?: string;
      workflowId?: string;
    };
  }>("/jobs", async (request, reply) => {
    const jobStatus = request.query.status
      ? workflowJobStatusSchema.safeParse(request.query.status)
      : undefined;

    if (jobStatus && !jobStatus.success) {
      return reply.code(400).send({
        error: "invalid_job_status",
        allowedStatuses: workflowJobStatusSchema.options
      });
    }

    const jobs = queue.listJobs().filter((job) => {
      if (jobStatus?.data && job.status !== jobStatus.data) {
        return false;
      }

      if (request.query.workflowId && job.workflowId !== request.query.workflowId) {
        return false;
      }

      if (request.query.repositoryId) {
        const workflow = activeRunner.getWorkflow(job.workflowId);
        if (workflow?.repositoryId !== request.query.repositoryId) {
          return false;
        }
      }

      return true;
    });

    return limitToRecent(jobs, request.query.limit);
  });

  app.post<{
    Params: { id: string };
  }>("/jobs/:id/cancel", async (request, reply) => {
    const job = queue.cancelJob(request.params.id);

    if (!job) {
      return reply.code(404).send({ error: "job_not_found" });
    }

    const workflow = activeRunner.getWorkflow(job.workflowId);
    auditStore.append({
      type: "job.canceled",
      actor: "operator",
      workflowId: job.workflowId,
      jobId: job.id,
      metadata: {
        repositoryId: workflow?.repositoryId ?? "",
        repositoryPath: workflow?.repositoryPath ?? "",
        status: job.status
      }
    });

    return job;
  });

  app.get<{
    Params: { id: string };
  }>("/jobs/:id/timeline", async (request, reply) => {
    const job = queue.getJob(request.params.id);

    if (!job) {
      return reply.code(404).send({ error: "job_not_found" });
    }

    const workflow = activeRunner.getWorkflow(job.workflowId);
    const report = workflow ? activeRunner.getReport(workflow.id) : undefined;
    const jobStartedAt = Date.parse(job.createdAt);
    const jobFinishedAt = job.finishedAt ? Date.parse(job.finishedAt) : undefined;
    const events = auditStore
      .list({ workflowId: job.workflowId })
      .filter((event) => {
        if (event.jobId) {
          return event.jobId === job.id;
        }

        if (!JOB_TIMELINE_WORKFLOW_EVENT_TYPES.has(event.type)) {
          return false;
        }

        const eventTime = Date.parse(event.createdAt);
        if (eventTime < jobStartedAt) {
          return false;
        }

        if (jobFinishedAt && eventTime > jobFinishedAt) {
          return false;
        }

        return true;
      });

    return {
      job,
      workflow: workflow
        ? {
            id: workflow.id,
            status: workflow.status,
            repositoryId: workflow.repositoryId,
            repositoryPath: workflow.repositoryPath
          }
        : undefined,
      summary: report
        ? {
            text: report.summary,
            recommendation: report.recommendation,
            failedTasks: report.failedTasks,
            failedGates: report.failedGates
          }
        : undefined,
      events
    };
  });

  app.get<{
    Params: { id: string };
  }>("/jobs/:id", async (request, reply) => {
    const job = queue.getJob(request.params.id);

    if (!job) {
      return reply.code(404).send({ error: "job_not_found" });
    }

    return job;
  });

  app.get<{
    Params: { id: string };
  }>("/workflows/:id/report", async (request, reply) => {
    try {
      return activeRunner.getReport(request.params.id);
    } catch {
      return reply.code(404).send({ error: "workflow_not_found" });
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { path?: string; maxBytes?: string };
  }>("/workflows/:id/artifact", async (request, reply) => {
    if (!activeRunner.getWorkflow(request.params.id)) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    if (!request.query.path) {
      return reply.code(400).send({ error: "artifact_path_required" });
    }

    const workflowArtifactRoot = resolve(artifactRoot, request.params.id);
    const artifactPath = resolveArtifactPath(
      request.query.path,
      workflowArtifactRoot
    );

    if (!isPathWithin(artifactPath, workflowArtifactRoot)) {
      return reply.code(403).send({
        error: "artifact_path_not_allowed",
        message: "Artifact path is outside this workflow artifact directory."
      });
    }

    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
      return reply.code(404).send({ error: "artifact_not_found" });
    }

    const sizeBytes = statSync(artifactPath).size;
    const maxBytes = parseArtifactMaxBytes(request.query.maxBytes);
    const truncated = sizeBytes > maxBytes;
    const content = readArtifactPrefix(artifactPath, maxBytes);

    auditStore.append({
      type: "workflow.artifact_read",
      actor: "operator",
      workflowId: request.params.id,
      metadata: {
        artifactPath,
        maxBytes: String(maxBytes),
        sizeBytes: String(sizeBytes),
        truncated: String(truncated)
      }
    });

    return {
      workflowId: request.params.id,
      path: artifactPath,
      content: truncated ? content.slice(0, maxBytes) : content,
      contentType: "text/plain; charset=utf-8",
      sizeBytes,
      maxBytes,
      truncated
    };
  });

  app.get<{
    Params: { id: string };
  }>("/workflows/:id/merge-candidate", async (request, reply) => {
    try {
      return activeRunner.getMergeCandidate(request.params.id);
    } catch {
      return reply.code(404).send({ error: "workflow_not_found" });
    }
  });

  return app;
}

function parseAllowedRepositoryRoots(value?: string): string[] {
  return (value ?? "")
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

function isRepositoryPathAllowed(path: string, allowedRoots: string[]): boolean {
  if (allowedRoots.length === 0) {
    return true;
  }

  const candidate = resolve(path);

  return allowedRoots.some((root) => {
    const normalizedRoot = resolve(root);
    return (
      candidate === normalizedRoot ||
      candidate.startsWith(`${normalizedRoot}${sep}`)
    );
  });
}

function limitToRecent<T>(items: T[], value?: string): T[] {
  if (!value) {
    return items;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return items;
  }

  return items.slice(-Math.min(parsed, 100));
}

function resolveArtifactPath(path: string, workflowArtifactRoot: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(workflowArtifactRoot, path);
}

function isPathWithin(path: string, root: string): boolean {
  const candidate = resolve(path);
  const normalizedRoot = resolve(root);

  return (
    candidate === normalizedRoot ||
    candidate.startsWith(`${normalizedRoot}${sep}`)
  );
}

function parseArtifactMaxBytes(value?: string): number {
  const defaultMaxBytes = 64 * 1024;

  if (!value) {
    return defaultMaxBytes;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultMaxBytes;
  }

  return Math.min(parsed, defaultMaxBytes);
}

function readArtifactPrefix(path: string, maxBytes: number): string {
  const file = openSync(path, "r");

  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(file, buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf8");

    while (Buffer.byteLength(content, "utf8") > maxBytes) {
      content = content.slice(0, -1);
    }

    return content;
  } finally {
    closeSync(file);
  }
}

function createWritableDirectoryCheck(
  id: string,
  label: string,
  path: string
) {
  try {
    mkdirSync(path, { recursive: true });
    const probePath = join(
      path,
      `.readiness-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
    );
    const file = openSync(probePath, "w");
    closeSync(file);
    unlinkSync(probePath);

    return {
      id,
      label,
      ok: true,
      status: "ready",
      path
    };
  } catch (error) {
    return {
      id,
      label,
      ok: false,
      status: "failed",
      path,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function createGitCliCheck() {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  const version = result.stdout.trim();

  if (result.status === 0) {
    return {
      id: "git_cli",
      label: "Git CLI",
      ok: true,
      status: "ready",
      version
    };
  }

  return {
    id: "git_cli",
    label: "Git CLI",
    ok: false,
    status: "failed",
    message: result.stderr.trim() || "git --version failed"
  };
}
