import cors from "@fastify/cors";
import {
  createRepositoryWorkflowRequestSchema,
  repositoryRegistrationRequestSchema,
  workflowReviewRequestSchema
} from "@mawo/shared";
import Fastify from "fastify";
import { join } from "node:path";
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

export function buildApp(runner?: LocalRunner, options: BuildAppOptions = {}) {
  const root = options.demoRoot ?? process.cwd();
  const cliAgents = createConfiguredAgentConfigs(options.env);
  const activeRunner =
    runner ??
    new LocalRunner(undefined, {
      cliAgents,
      runStore: new FileRunStore({
        stateFile: join(root, ".mawo", "state", "workflows.json")
      }),
      artifactStore: new FileArtifactStore({
        root: join(root, ".mawo", "artifacts")
      })
    });
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test"
  });
  const queue = new WorkflowJobQueue({
    runner: activeRunner,
    jobStore:
      options.jobStore ??
      new FileJobStore({
        stateFile: join(root, ".mawo", "state", "jobs.json")
      })
  });
  const auditStore =
    options.auditStore ??
    new FileAuditStore({
      stateFile: join(root, ".mawo", "state", "audit-events.json")
    });
  const repositoryStore =
    options.repositoryStore ??
    new FileRepositoryStore({
      stateFile: join(root, ".mawo", "state", "repositories.json")
    });

  app.register(cors, {
    origin: true
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "mawo-api"
    };
  });

  app.get("/agents", async () => {
    return createAgentSummaries(cliAgents);
  });

  app.get("/agents/health", async () => {
    return createAgentHealthChecks(cliAgents);
  });

  app.get("/workflows", async () => {
    return activeRunner.listWorkflows();
  });

  app.get<{
    Querystring: { workflowId?: string };
  }>("/audit-events", async (request) => {
    return auditStore.list({
      workflowId: request.query.workflowId
    });
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
      const repository = repositoryStore.create(parsed.data);

      return reply.code(201).send(repository);
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
          cleanedCount: String(cleanup.cleaned.length)
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
    if (!activeRunner.getWorkflow(request.params.id)) {
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

  app.get("/jobs", async () => {
    return queue.listJobs();
  });

  app.post<{
    Params: { id: string };
  }>("/jobs/:id/cancel", async (request, reply) => {
    const job = queue.cancelJob(request.params.id);

    if (!job) {
      return reply.code(404).send({ error: "job_not_found" });
    }

    auditStore.append({
      type: "job.canceled",
      actor: "operator",
      workflowId: job.workflowId,
      jobId: job.id,
      metadata: {
        status: job.status
      }
    });

    return job;
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
  }>("/workflows/:id/merge-candidate", async (request, reply) => {
    try {
      return activeRunner.getMergeCandidate(request.params.id);
    } catch {
      return reply.code(404).send({ error: "workflow_not_found" });
    }
  });

  return app;
}
