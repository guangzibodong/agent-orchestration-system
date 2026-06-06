import cors from "@fastify/cors";
import {
  auditEventTypeSchema,
  createRequirementDeliveryTicketRequestSchema,
  createRepositoryWorkflowRequestSchema,
  launchGateEvidenceSchema,
  requirementStatusSchema,
  repositoryRegistrationRequestSchema,
  updateRequirementDeliveryTicketRequestSchema,
  workflowJobStatusSchema,
  workflowStatusSchema,
  workflowReviewRequestSchema,
  type WorkflowJob,
  type AuditEvent,
  type RequirementDeliveryTicket,
  type RequirementStatus,
  type WorkflowRun,
} from "@mawo/shared";
import Fastify from "fastify";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve, sep, join, isAbsolute } from "node:path";
import { prisma } from "./db.js";
import { FileArtifactStore } from "./runner/file-artifact-store.js";
import {
  FileAuditStore,
  type AuditEventInput,
  type AuditStore,
} from "./runner/file-audit-store.js";
import { FileJobStore, type JobStore } from "./runner/file-job-store.js";
import {
  FileRequirementStore,
  RequirementPlanConfirmationBlockedError,
  RequirementPlanNotReadyError,
  type RequirementStore,
} from "./runner/file-requirement-store.js";
import {
  FileRepositoryStore,
  type RepositoryStore,
} from "./runner/file-repository-store.js";
import { FileRunStore, type RunStore } from "./runner/file-run-store.js";
import {
  PrismaAuditStore,
  type PrismaAuditStoreClient,
} from "./runner/prisma-audit-store.js";
import {
  PrismaJobStore,
  type PrismaJobStoreClient,
} from "./runner/prisma-job-store.js";
import { PostgresWorkflowJobQueue } from "./runner/postgres-workflow-job-queue.js";
import {
  PrismaRepositoryStore,
  type PrismaRepositoryStoreClient,
} from "./runner/prisma-repository-store.js";
import {
  PrismaRunStore,
  type PrismaRunStoreClient,
} from "./runner/prisma-run-store.js";
import {
  createAgentHealthChecks,
  createAgentSummaries,
  createConfiguredAgentConfigs,
} from "./runner/agent-config.js";
import {
  createDemoWorkflowDefinition,
  LocalRunner,
  WorkflowMergeCandidateApplyBlockedError,
  WorkflowMergeCandidateNotReadyError,
  WorkflowNotRetryableError,
  WorkflowNotReviewReadyError,
  WorkflowWorkspacesNotCleanableError,
} from "./runner/local-runner.js";
import {
  createAgentDemoWorkflowDefinition,
  createWorktreeDemoWorkflowDefinition,
} from "./runner/demo-repository.js";
import {
  createRepositoryWorkflowDefinition,
  RepositoryNotReadyError,
} from "./runner/repository-workflow.js";
import {
  inspectRepositorySafety,
  type RepositorySafetyInspector,
} from "./runner/repository-safety.js";
import {
  WorkflowAlreadyRunningError,
  WorkflowJobQueue,
} from "./runner/workflow-job-queue.js";

export type BuildAppOptions = {
  demoRoot?: string;
  env?: Record<string, string | undefined>;
  auditStore?: AuditStore;
  jobStore?: JobStore;
  prismaClient?: PrismaStateStoreClient;
  runStore?: RunStore;
  repositoryStore?: RepositoryStore;
  requirementStore?: RequirementStore;
  repositorySafetyInspector?: RepositorySafetyInspector;
};

type PrismaStateStoreClient = PrismaAuditStoreClient &
  PrismaJobStoreClient &
  PrismaRepositoryStoreClient &
  PrismaRunStoreClient;

type ApiAuthRole = "operator" | "viewer";

type ActiveQueueBackend = "in_process" | "postgres";

const VIEWER_READ_ENDPOINTS: Array<string | RegExp> = [
  "/readiness",
  "/agents",
  "/agents/health",
  "/workers/health",
  "/operations/snapshot",
  "/launch/evidence/latest",
  "/repositories",
  /^\/repositories\/[^/]+\/safety$/,
  "/requirements",
  /^\/requirements\/[^/]+\/merge-candidate$/,
  /^\/requirements\/[^/]+\/report$/,
  /^\/requirements\/[^/]+$/,
  "/workflows",
  /^\/workflows\/[^/]+$/,
  /^\/workflows\/[^/]+\/report$/,
  /^\/workflows\/[^/]+\/artifact$/,
  /^\/workflows\/[^/]+\/merge-candidate$/,
  /^\/workflows\/[^/]+\/workspaces$/,
  "/jobs",
  /^\/jobs\/[^/]+$/,
  /^\/jobs\/[^/]+\/timeline$/,
  "/audit-events",
];

function requestPath(url: string): string {
  return url.split("?")[0] || "/";
}

function isViewerReadableEndpoint(method: string, url: string): boolean {
  if (method !== "GET") {
    return false;
  }

  const path = requestPath(url);
  return VIEWER_READ_ENDPOINTS.some((endpoint) =>
    typeof endpoint === "string" ? endpoint === path : endpoint.test(path),
  );
}

function mapWorkflowToRequirementStatus(
  workflow: Pick<WorkflowRun, "review" | "status">,
  currentStatus: RequirementStatus,
): RequirementStatus {
  switch (workflow.status) {
    case "running":
      return "running";
    case "gate_failed":
    case "failed":
    case "aborted":
      return "needs_rework";
    case "needs_review":
      return "needs_review";
    case "completed":
      return workflow.review?.decision === "approved"
        ? "delivered"
        : currentStatus;
    case "archived":
      return "archived";
    case "draft":
    case "ready":
      return currentStatus;
  }
}

function createStateStores(input: {
  requestedStateBackend: string;
  stateRoot: string;
  prismaClient: PrismaStateStoreClient;
}): {
  activeStateBackend: "file" | "postgres";
  auditStore: AuditStore;
  jobStore: JobStore;
  requirementStore: RequirementStore;
  repositoryStore: RepositoryStore;
  runStore: RunStore;
} {
  if (input.requestedStateBackend === "postgres") {
    return {
      activeStateBackend: "postgres",
      auditStore: new PrismaAuditStore(input.prismaClient),
      jobStore: new PrismaJobStore(input.prismaClient),
      requirementStore: new FileRequirementStore({
        stateFile: join(input.stateRoot, "requirements.json"),
      }),
      repositoryStore: new PrismaRepositoryStore(input.prismaClient),
      runStore: new PrismaRunStore(input.prismaClient),
    };
  }

  return {
    activeStateBackend: "file",
    auditStore: new FileAuditStore({
      stateFile: join(input.stateRoot, "audit-events.json"),
    }),
    jobStore: new FileJobStore({
      stateFile: join(input.stateRoot, "jobs.json"),
    }),
    requirementStore: new FileRequirementStore({
      stateFile: join(input.stateRoot, "requirements.json"),
    }),
    repositoryStore: new FileRepositoryStore({
      stateFile: join(input.stateRoot, "repositories.json"),
    }),
    runStore: new FileRunStore({
      stateFile: join(input.stateRoot, "workflows.json"),
    }),
  };
}

function selectActiveQueueBackend(input: {
  requestedQueueBackend: string;
  activeStateBackend: "file" | "postgres";
}): ActiveQueueBackend {
  if (
    input.requestedQueueBackend === "postgres" &&
    input.activeStateBackend === "postgres"
  ) {
    return "postgres";
  }

  return "in_process";
}

const JOB_TIMELINE_WORKFLOW_EVENT_TYPES = new Set([
  "workflow.task_started",
  "workflow.task_completed",
  "workflow.gate_started",
  "workflow.gate_completed",
]);

export function buildApp(runner?: LocalRunner, options: BuildAppOptions = {}) {
  const root = options.demoRoot ?? process.cwd();
  const stateRoot = join(root, ".mawo", "state");
  const artifactRoot = join(root, ".mawo", "artifacts");
  const env = options.env ?? process.env;
  const apiToken = env.MAWO_API_TOKEN?.trim();
  const viewerApiToken = env.MAWO_VIEWER_API_TOKEN?.trim();
  const authRequired = Boolean(apiToken || viewerApiToken);
  const deploymentMode =
    env.NODE_ENV === "production" ? "production" : "development";
  const apiReplicaCount = parseApiReplicaCount(env.MAWO_API_REPLICA_COUNT);
  const maxConcurrentJobs = parseMaxConcurrentJobs(
    env.MAWO_MAX_CONCURRENT_JOBS,
  );
  const workerStaleAfterMs = parseWorkerStaleAfterMs(env.MAWO_WORKER_STALE_MS);
  const requestedStateBackend = parseRuntimeBackend(
    env.MAWO_STATE_BACKEND,
    "file",
  );
  const requestedQueueBackend = parseRuntimeBackend(
    env.MAWO_QUEUE_BACKEND,
    "in_process",
  );
  const allowedRepositoryRoots = parseAllowedRepositoryRoots(
    env.MAWO_ALLOWED_REPOSITORY_ROOTS,
  );
  const cliAgents = createConfiguredAgentConfigs(env);
  const stateStores = createStateStores({
    requestedStateBackend,
    stateRoot,
    prismaClient:
      options.prismaClient ?? (prisma as unknown as PrismaStateStoreClient),
  });
  const activeStateBackend = stateStores.activeStateBackend;
  const activeQueueBackend = selectActiveQueueBackend({
    requestedQueueBackend,
    activeStateBackend,
  });
  const auditStore = options.auditStore ?? stateStores.auditStore;
  const jobStore = options.jobStore ?? stateStores.jobStore;
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });
  const appendAuditEvent = (event: AuditEventInput) =>
    Promise.resolve(auditStore.append(event));
  const getWorkerHealth = async () =>
    createWorkerHealth(
      await auditStore.list({ type: "worker.heartbeat" }),
      workerStaleAfterMs,
    );
  const appendAuditEventInBackground = (event: AuditEventInput) => {
    void appendAuditEvent(event).catch((error: unknown) => {
      app.log.error({ error }, "failed to append audit event");
    });
  };
  const activeRunner =
    runner ??
    new LocalRunner(undefined, {
      cliAgents,
      runStore: options.runStore ?? stateStores.runStore,
      artifactStore: new FileArtifactStore({
        root: artifactRoot,
      }),
      eventSink: (event) => {
        appendAuditEventInBackground({
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
              : {}),
          },
        });
      },
    });
  const queue =
    activeQueueBackend === "postgres"
      ? new PostgresWorkflowJobQueue({
          jobStore,
        })
      : new WorkflowJobQueue({
          runner: activeRunner,
          maxConcurrentJobs,
          jobStore,
          onJobRecovered: ({ original, recovered }) => {
            const workflowRecovery = activeRunner.recoverInterruptedWorkflow(
              recovered.workflowId,
            );
            appendAuditEventInBackground({
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
                recoveredGateIds: workflowRecovery.recoveredGates.join(","),
              },
            });
          },
        });
  app.addHook("onReady", async () => {
    await activeRunner.ready();
    await queue.ready();
    await activeRunner.flush();
    await queue.flush();
  });
  const repositoryStore =
    options.repositoryStore ?? stateStores.repositoryStore;
  const requirementStore =
    options.requirementStore ?? stateStores.requirementStore;
  const repositorySafetyInspector =
    options.repositorySafetyInspector ?? inspectRepositorySafety;
  const requirementEnqueueLocks = new Set<string>();
  const syncRequirementWithWorkflow = async (
    requirement: RequirementDeliveryTicket,
  ): Promise<RequirementDeliveryTicket> => {
    if (!requirement.currentWorkflowRunId) {
      return requirement;
    }

    await activeRunner.refreshFromStore();
    const workflow = activeRunner.getWorkflow(requirement.currentWorkflowRunId);
    if (!workflow) {
      return requirement;
    }

    const requirementStatus = mapWorkflowToRequirementStatus(
      workflow,
      requirement.status,
    );
    const currentRunLink = requirement.runLinks.find(
      (runLink) => runLink.workflowRunId === workflow.id,
    );

    if (
      requirement.status === requirementStatus &&
      currentRunLink?.status === workflow.status
    ) {
      return requirement;
    }

    return (
      (await requirementStore.syncWorkflowRunStatus(requirement.id, {
        workflowRunId: workflow.id,
        workflowStatus: workflow.status,
        requirementStatus,
      })) ?? requirement
    );
  };
  const syncRequirementsForCanceledJob = async (
    job: WorkflowJob,
    workflow: WorkflowRun | undefined,
  ): Promise<void> => {
    if (!workflow || workflow.status !== "ready") {
      return;
    }

    const requirements = await requirementStore.list();
    await Promise.all(
      requirements
        .filter(
          (requirement) =>
            requirement.currentWorkflowRunId === job.workflowId &&
            requirement.status === "running",
        )
        .map((requirement) =>
          requirementStore.syncWorkflowRunStatus(requirement.id, {
            workflowRunId: workflow.id,
            workflowStatus: workflow.status,
            requirementStatus: "ready_to_run",
          }),
        ),
    );
  };

  app.register(cors, {
    origin: true,
  });

  const identifyAuthRole = (authorization: string): ApiAuthRole | undefined => {
    if (apiToken && authorization === `Bearer ${apiToken}`) {
      return "operator";
    }

    if (viewerApiToken && authorization === `Bearer ${viewerApiToken}`) {
      return "viewer";
    }

    return undefined;
  };

  app.addHook("preHandler", async (request, reply) => {
    if (
      !authRequired ||
      request.method === "OPTIONS" ||
      request.url === "/health"
    ) {
      return;
    }

    const authorization = request.headers.authorization ?? "";
    const role = identifyAuthRole(authorization);
    if (!role) {
      return reply
        .code(401)
        .header("www-authenticate", "Bearer")
        .send({ error: "unauthorized" });
    }

    if (
      role === "viewer" &&
      !isViewerReadableEndpoint(request.method, request.url)
    ) {
      return reply.code(403).send({
        error: "forbidden",
        message: "This endpoint requires an operator token.",
        requiredRole: "operator",
        role,
      });
    }

    if (role === "operator" || role === "viewer") {
      return;
    }
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "mawo-api",
    };
  });

  const buildReadinessResponse = async () => {
    const checkedAt = new Date().toISOString();
    const storeChecks = [
      createWritableDirectoryCheck("state_store", "State store", stateRoot),
      createWritableDirectoryCheck(
        "artifact_store",
        "Artifact store",
        artifactRoot,
      ),
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
          command: agent.command,
        })),
    };
    const activeJobs = (await queue.listJobs()).filter(
      (job) => job.status === "queued" || job.status === "running",
    ).length;
    const productionConfigCheck = createProductionConfigCheck({
      deploymentMode,
      apiToken,
      allowedRepositoryRoots,
    });
    const deploymentTopologyCheck = createDeploymentTopologyCheck({
      deploymentMode,
      apiReplicaCount,
      stateBackend: activeStateBackend,
      queueBackend: activeQueueBackend,
    });
    const workerHealth = await getWorkerHealth();
    const workerHealthCheck = createWorkerHealthCheck({
      queueBackend: activeQueueBackend,
      workerHealth,
    });
    const runtimeBackendCheck = createRuntimeBackendCheck({
      requestedStateBackend,
      requestedQueueBackend,
      activeStateBackend,
      activeQueueBackend,
      maxConcurrentJobs,
      databaseUrlConfigured: Boolean(env.DATABASE_URL?.trim()),
      redisUrlConfigured: Boolean(env.REDIS_URL?.trim()),
    });
    const checks = [
      ...storeChecks,
      gitCheck,
      agentsCheck,
      productionConfigCheck,
      runtimeBackendCheck,
      workerHealthCheck,
      deploymentTopologyCheck,
    ];

    return {
      ok: checks.every((check) => check.ok),
      service: "mawo-api",
      checkedAt,
      deploymentMode,
      protectedByToken: authRequired,
      root,
      activeJobs,
      checks,
    };
  };

  const listJobsForOperations = async (input: {
    limit?: string;
    repositoryId?: string;
    status?: string;
    workflowId?: string;
  }): Promise<WorkflowJob[]> => {
    const jobStatus = input.status
      ? workflowJobStatusSchema.safeParse(input.status)
      : undefined;

    const jobs = (await queue.listJobs()).filter((job) => {
      if (jobStatus?.success && job.status !== jobStatus.data) {
        return false;
      }

      if (input.workflowId && job.workflowId !== input.workflowId) {
        return false;
      }

      if (input.repositoryId) {
        const workflow = activeRunner.getWorkflow(job.workflowId);
        if (workflow?.repositoryId !== input.repositoryId) {
          return false;
        }
      }

      return true;
    });

    return limitToRecent(jobs, input.limit);
  };

  const listAuditEventsForOperations = async (input: {
    actor?: string;
    jobId?: string;
    limit?: string;
    repositoryId?: string;
    type?: string;
    workflowId?: string;
  }): Promise<AuditEvent[]> => {
    const eventType = input.type
      ? auditEventTypeSchema.safeParse(input.type)
      : undefined;
    const events = await auditStore.list({
      ...(eventType?.success ? { type: eventType.data } : {}),
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
    });

    return limitToRecent(events, input.limit);
  };

  app.get("/readiness", async () => buildReadinessResponse());

  app.get("/launch/evidence/latest", async (_request, reply) => {
    try {
      const evidence = readLatestLaunchGateEvidence(root);

      if (!evidence) {
        return reply.code(404).send({
          error: "launch_gate_evidence_not_found",
          message:
            "Run npm.cmd run launch:gate:local to generate launch readiness evidence.",
        });
      }

      return evidence;
    } catch (error) {
      return reply.code(500).send({
        error: "invalid_launch_gate_evidence",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/agents", async () => {
    return createAgentSummaries(cliAgents);
  });

  app.get("/agents/health", async () => {
    return createAgentHealthChecks(cliAgents);
  });

  app.get("/workers/health", async () => {
    return getWorkerHealth();
  });

  app.get<{
    Querystring: { limit?: string; repositoryId?: string };
  }>("/operations/snapshot", async (request) => {
    await activeRunner.refreshFromStore();
    const repositoryId = request.query.repositoryId?.trim() || undefined;
    const limit = request.query.limit || "8";
    const [readiness, workerHealth, jobs, auditEvents] = await Promise.all([
      buildReadinessResponse(),
      getWorkerHealth(),
      listJobsForOperations({ limit, repositoryId }),
      listAuditEventsForOperations({ limit, repositoryId }),
    ]);
    const scopedWorkflows = activeRunner.listWorkflows().filter((workflow) => {
      if (repositoryId && workflow.repositoryId !== repositoryId) {
        return false;
      }

      return true;
    });
    const queuedJobs = jobs.filter((job) => job.status === "queued").length;
    const runningJobs = jobs.filter((job) => job.status === "running").length;

    return {
      checkedAt: new Date().toISOString(),
      ...(repositoryId ? { repositoryId } : {}),
      summary: {
        queuedJobs,
        runningJobs,
        activeJobs: queuedJobs + runningJobs,
        failedJobs: jobs.filter((job) => job.status === "failed").length,
        needsReviewWorkflows: scopedWorkflows.filter(
          (workflow) => workflow.status === "needs_review",
        ).length,
        blockedReadinessChecks: readiness.checks.filter(
          (check) => check.status === "blocked" || check.status === "failed",
        ).length,
        healthyWorkers: workerHealth.summary.healthyWorkers,
        totalWorkers: workerHealth.summary.totalWorkers,
      },
      auditEvents,
      jobs,
      readiness,
      workerHealth,
    };
  });

  app.get<{
    Querystring: {
      limit?: string;
      repositoryId?: string;
      repositoryPath?: string;
      status?: string;
    };
  }>("/workflows", async (request, reply) => {
    await activeRunner.refreshFromStore();
    const workflowStatus = request.query.status
      ? workflowStatusSchema.safeParse(request.query.status)
      : undefined;

    if (workflowStatus && !workflowStatus.success) {
      return reply.code(400).send({
        error: "invalid_workflow_status",
        allowedStatuses: workflowStatusSchema.options,
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
        allowedTypes: auditEventTypeSchema.options,
      });
    }

    const events = await auditStore.list({
      actor: request.query.actor,
      jobId: request.query.jobId,
      repositoryId: request.query.repositoryId,
      type: eventType?.data,
      workflowId: request.query.workflowId,
    });
    return limitToRecent(events, request.query.limit);
  });

  app.get("/repositories", async () => {
    return await repositoryStore.list();
  });

  app.get<{
    Params: { id: string };
  }>("/repositories/:id/safety", async (request, reply) => {
    const repository = await repositoryStore.get(request.params.id);

    if (!repository) {
      return reply.code(404).send({ error: "repository_not_found" });
    }

    return await repositorySafetyInspector({
      repository,
      allowedRoots: allowedRepositoryRoots,
    });
  });

  app.post("/repositories", async (request, reply) => {
    const parsed = repositoryRegistrationRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_repository_registration_request",
        issues: parsed.error.issues,
      });
    }

    try {
      if (!isRepositoryPathAllowed(parsed.data.path, allowedRepositoryRoots)) {
        return reply.code(403).send({
          error: "repository_path_not_allowed",
          message: "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS.",
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
              command: "git status --short",
            },
          ],
          qualityGates: [],
        },
        { root },
      );
      const result = await repositoryStore.upsert(parsed.data);
      const repository = result.repository;
      await appendAuditEvent({
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
          qualityGates: String(repository.qualityGates.length),
        },
      });

      return reply.code(result.created ? 201 : 200).send(repository);
    } catch (error) {
      if (error instanceof RepositoryNotReadyError) {
        return reply.code(422).send({
          error: "repository_not_ready",
          message: error.message,
        });
      }

      throw error;
    }
  });

  app.delete<{
    Params: { id: string };
  }>("/repositories/:id", async (request, reply) => {
    const repository = await repositoryStore.remove(request.params.id);

    if (!repository) {
      return reply.code(404).send({ error: "repository_not_found" });
    }

    await appendAuditEvent({
      type: "repository.deleted",
      actor: "operator",
      metadata: {
        repositoryId: repository.id,
        repositoryName: repository.name,
        repositoryPath: repository.path,
        defaultBranch: repository.defaultBranch ?? "",
        qualityGates: String(repository.qualityGates.length),
      },
    });

    return repository;
  });

  app.post("/requirements", async (request, reply) => {
    const parsed = createRequirementDeliveryTicketRequestSchema.safeParse(
      request.body,
    );

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_requirement_delivery_ticket_request",
        issues: parsed.error.issues,
      });
    }

    const requirement = await requirementStore.create(parsed.data);

    return reply.code(201).send(requirement);
  });

  app.get<{
    Querystring: {
      limit?: string;
      repositoryId?: string;
      repositoryPath?: string;
      status?: string;
    };
  }>("/requirements", async (request, reply) => {
    const requirementStatus = request.query.status
      ? requirementStatusSchema.safeParse(request.query.status)
      : undefined;

    if (requirementStatus && !requirementStatus.success) {
      return reply.code(400).send({
        error: "invalid_requirement_status",
        allowedStatuses: requirementStatusSchema.options,
      });
    }

    const repositoryPath = request.query.repositoryPath
      ? resolve(request.query.repositoryPath)
      : undefined;
    const syncedRequirements = await Promise.all(
      (await requirementStore.list()).map(syncRequirementWithWorkflow),
    );
    const requirements = syncedRequirements.filter(
      (requirement) => {
        if (
          requirementStatus?.data &&
          requirement.status !== requirementStatus.data
        ) {
          return false;
        }

        if (
          request.query.repositoryId &&
          requirement.repositoryId !== request.query.repositoryId
        ) {
          return false;
        }

        if (
          repositoryPath &&
          (!requirement.repositoryPath ||
            resolve(requirement.repositoryPath) !== repositoryPath)
        ) {
          return false;
        }

        return true;
      },
    );

    return limitToRecent(requirements, request.query.limit);
  });

  app.get<{
    Params: { id: string };
  }>("/requirements/:id", async (request, reply) => {
    const requirement = await requirementStore.get(request.params.id);

    if (!requirement) {
      return reply.code(404).send({ error: "requirement_not_found" });
    }

    return syncRequirementWithWorkflow(requirement);
  });

  app.patch<{
    Params: { id: string };
  }>("/requirements/:id", async (request, reply) => {
    const parsed = updateRequirementDeliveryTicketRequestSchema.safeParse(
      request.body,
    );

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_requirement_delivery_ticket_update",
        issues: parsed.error.issues,
      });
    }

    const requirement = await requirementStore.update(
      request.params.id,
      parsed.data,
    );

    if (!requirement) {
      return reply.code(404).send({ error: "requirement_not_found" });
    }

    return requirement;
  });

  app.post<{
    Params: { id: string };
  }>("/requirements/:id/confirm-plan", async (request, reply) => {
    try {
      const requirement = await requirementStore.confirmPlan(request.params.id);

      if (!requirement) {
        return reply.code(404).send({ error: "requirement_not_found" });
      }

      return requirement;
    } catch (error) {
      if (error instanceof RequirementPlanNotReadyError) {
        return reply.code(409).send({
          error: "requirement_plan_not_ready",
          message: error.message,
          missingFields: error.missingFields,
        });
      }

      if (error instanceof RequirementPlanConfirmationBlockedError) {
        return reply.code(409).send({
          error: "requirement_plan_confirmation_blocked",
          message: error.message,
          status: error.status,
        });
      }

      throw error;
    }
  });

  app.post<{
    Params: { id: string };
  }>("/requirements/:id/enqueue", async (request, reply) => {
    const requirement = await requirementStore.get(request.params.id);

    if (!requirement) {
      return reply.code(404).send({ error: "requirement_not_found" });
    }

    if (requirement.status !== "ready_to_run") {
      return reply.code(409).send({
        error: "requirement_not_ready_to_run",
        message: "Confirm a complete requirement plan before enqueueing it.",
        status: requirement.status,
      });
    }

    if (requirementEnqueueLocks.has(requirement.id)) {
      return reply.code(409).send({
        error: "requirement_enqueue_in_progress",
        message:
          "This requirement is already being enqueued. Wait for the current enqueue attempt to finish.",
        requirementId: requirement.id,
      });
    }

    requirementEnqueueLocks.add(requirement.id);
    try {
      await activeRunner.refreshFromStore();

      let workflow = requirement.currentWorkflowRunId
        ? activeRunner.getWorkflow(requirement.currentWorkflowRunId)
        : undefined;

      if (!workflow && !requirement.currentWorkflowRunId) {
        const repository = requirement.repositoryId
          ? await repositoryStore.get(requirement.repositoryId)
          : undefined;

        if (requirement.repositoryId && !repository) {
          return reply.code(404).send({ error: "repository_not_found" });
        }

        const repositoryPath = repository?.path ?? requirement.repositoryPath;
        if (!repositoryPath) {
          return reply.code(400).send({
            error: "repository_path_required",
          });
        }

        const safety = await repositorySafetyInspector({
          repository: repository ?? {
            id: requirement.id,
            name: requirement.title,
            path: repositoryPath,
            qualityGates: [],
            createdAt: requirement.createdAt,
            updatedAt: requirement.updatedAt,
          },
          allowedRoots: allowedRepositoryRoots,
        });

        if (!safety.allowedRoot) {
          return reply.code(403).send({
            error: "repository_path_not_allowed",
            message: "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS.",
            safety,
          });
        }

        if (safety.dirty) {
          return reply.code(409).send({
            error: "repository_not_clean",
            message:
              "Commit, stash, or discard local changes before enqueueing a requirement.",
            safety,
          });
        }

        if (safety.blockedReason) {
          return reply.code(422).send({
            error: "repository_not_ready",
            message: safety.recoveryAction,
            safety,
          });
        }

        const definition = await createRepositoryWorkflowDefinition(
          {
            goal: requirement.goal,
            repositoryId: requirement.repositoryId,
            repositoryPath,
            tasks: requirement.tasks,
            qualityGates:
              requirement.qualityGates.length > 0
                ? requirement.qualityGates
                : (repository?.qualityGates ?? []),
          },
          {
            root,
          },
        );
        workflow = activeRunner.createWorkflow(definition);
        await activeRunner.flush();

        await appendAuditEvent({
          type: "workflow.created",
          actor: "operator",
          workflowId: workflow.id,
          metadata: {
            source: "requirement",
            requirementId: requirement.id,
            repositoryId: workflow.repositoryId ?? "",
            repositoryPath: workflow.repositoryPath ?? "",
          },
        });
      }

      if (!workflow) {
        return reply.code(409).send({
          error: "requirement_workflow_not_found",
          message:
            "Requirement points to a workflow run that is not available in the runner store.",
          workflowRunId: requirement.currentWorkflowRunId,
        });
      }

      if (workflow.status !== "ready") {
        return reply.code(409).send({
          error: "requirement_workflow_not_ready",
          message: "Retry or resolve the linked workflow before enqueueing.",
          workflowRunId: workflow.id,
          workflowStatus: workflow.status,
        });
      }

      const nextRequirement = requirement.currentWorkflowRunId
        ? await requirementStore.setStatus(requirement.id, "running")
        : await requirementStore.linkWorkflowRun(requirement.id, {
            workflowRunId: workflow.id,
            workflowStatus: workflow.status,
            requirementStatus: "running",
          });

      const job = await queue.enqueue(workflow.id);
      await queue.flush();

      await appendAuditEvent({
        type: "workflow.enqueued",
        actor: "operator",
        workflowId: workflow.id,
        jobId: job.id,
        metadata: {
          requirementId: requirement.id,
          repositoryId: workflow.repositoryId ?? "",
          repositoryPath: workflow.repositoryPath ?? "",
          status: job.status,
        },
      });

      return reply.code(202).send({
        requirement: nextRequirement,
        workflow,
        job,
      });
    } catch (error) {
      if (error instanceof WorkflowAlreadyRunningError) {
        return reply.code(409).send({
          error: "workflow_already_running",
          message: error.message,
          job: error.job,
        });
      }

      if (error instanceof RepositoryNotReadyError) {
        return reply.code(422).send({
          error: "repository_not_ready",
          message: error.message,
        });
      }

      throw error;
    } finally {
      requirementEnqueueLocks.delete(requirement.id);
    }
  });

  app.post<{
    Params: { id: string };
  }>("/requirements/:id/retry", async (request, reply) => {
    const requirement = await requirementStore.get(request.params.id);

    if (!requirement) {
      return reply.code(404).send({ error: "requirement_not_found" });
    }

    if (!requirement.currentWorkflowRunId) {
      return reply.code(409).send({
        error: "requirement_workflow_required",
        message: "Requirement has no linked workflow run to retry.",
        status: requirement.status,
      });
    }

    await activeRunner.refreshFromStore();

    if (!activeRunner.getWorkflow(requirement.currentWorkflowRunId)) {
      return reply.code(409).send({
        error: "requirement_workflow_not_found",
        message:
          "Requirement points to a workflow run that is not available in the runner store.",
        workflowRunId: requirement.currentWorkflowRunId,
      });
    }

    try {
      const retry = await activeRunner.retryWorkflowWithResult(
        requirement.currentWorkflowRunId,
      );
      await activeRunner.flush();
      const nextRequirement = await requirementStore.syncWorkflowRunStatus(
        requirement.id,
        {
          workflowRunId: retry.run.id,
          workflowStatus: retry.run.status,
          requirementStatus: "ready_to_run",
        },
      );

      await appendAuditEvent({
        type: "workflow.retry_requested",
        actor: "operator",
        workflowId: retry.run.id,
        metadata: {
          requirementId: requirement.id,
          previousStatus: retry.previousStatus,
          status: retry.run.status,
          cleanedCount: String(retry.cleanedWorkspaces.length),
          cleanedTaskIds: retry.cleanedWorkspaces
            .map((item) => item.taskId)
            .join(","),
          cleanedBranches: retry.cleanedWorkspaces
            .map((item) => item.branch)
            .join(","),
          cleanedPaths: retry.cleanedWorkspaces
            .map((item) => item.path)
            .join(","),
        },
      });

      return {
        requirement: nextRequirement,
        workflow: retry.run,
        retry,
      };
    } catch (error) {
      if (error instanceof WorkflowNotRetryableError) {
        return reply.code(409).send({
          error: "workflow_not_retryable",
          message: error.message,
        });
      }

      throw error;
    }
  });

  app.get<{
    Params: { id: string };
  }>("/requirements/:id/report", async (request, reply) => {
    const requirement = await requirementStore.get(request.params.id);

    if (!requirement) {
      return reply.code(404).send({ error: "requirement_not_found" });
    }

    if (!requirement.currentWorkflowRunId) {
      return reply.code(409).send({
        error: "requirement_report_not_ready",
        message:
          "Requirement has no linked workflow run with report evidence yet.",
        status: requirement.status,
      });
    }

    await activeRunner.refreshFromStore();
    const workflow = activeRunner.getWorkflow(requirement.currentWorkflowRunId);

    if (!workflow || !hasCurrentRequirementReport(workflow)) {
      return reply.code(409).send({
        error: "requirement_report_not_ready",
        message:
          "Linked workflow report evidence is not current for this requirement.",
        workflowRunId: requirement.currentWorkflowRunId,
        status: requirement.status,
        workflowStatus: workflow?.status,
      });
    }

    try {
      return activeRunner.getReport(requirement.currentWorkflowRunId);
    } catch {
      return reply.code(409).send({
        error: "requirement_report_not_ready",
        message:
          "Linked workflow report evidence is not available for this requirement.",
        workflowRunId: requirement.currentWorkflowRunId,
        status: requirement.status,
      });
    }
  });

  app.get<{
    Params: { id: string };
  }>("/requirements/:id/merge-candidate", async (request, reply) => {
    const requirement = await requirementStore.get(request.params.id);

    if (!requirement) {
      return reply.code(404).send({ error: "requirement_not_found" });
    }

    if (!requirement.currentWorkflowRunId) {
      return reply.code(409).send({
        error: "requirement_merge_candidate_not_ready",
        message:
          "Requirement has no linked workflow run with merge candidate evidence yet.",
        status: requirement.status,
      });
    }

    await activeRunner.refreshFromStore();
    const workflow = activeRunner.getWorkflow(requirement.currentWorkflowRunId);

    if (!workflow || !hasCurrentRequirementMergeCandidate(workflow)) {
      return reply.code(409).send({
        error: "requirement_merge_candidate_not_ready",
        message:
          "Linked workflow merge candidate evidence is not current for this requirement.",
        workflowRunId: requirement.currentWorkflowRunId,
        status: requirement.status,
        workflowStatus: workflow?.status,
      });
    }

    try {
      return activeRunner.getMergeCandidate(requirement.currentWorkflowRunId);
    } catch (error) {
      if (error instanceof WorkflowMergeCandidateNotReadyError) {
        return reply.code(409).send({
          error: "requirement_merge_candidate_not_ready",
          message: error.message,
          workflowRunId: requirement.currentWorkflowRunId,
          status: error.status,
        });
      }

      return reply.code(409).send({
        error: "requirement_merge_candidate_not_ready",
        message:
          "Linked workflow merge candidate evidence is not available for this requirement.",
        workflowRunId: requirement.currentWorkflowRunId,
        status: requirement.status,
      });
    }
  });

  app.post("/workflows/demo", async (_request, reply) => {
    const run = activeRunner.createWorkflow(createDemoWorkflowDefinition());
    await activeRunner.flush();

    await appendAuditEvent({
      type: "workflow.created",
      actor: "operator",
      workflowId: run.id,
      metadata: {
        source: "demo",
      },
    });

    return reply.code(201).send(run);
  });

  app.post("/workflows/worktree-demo", async (_request, reply) => {
    const definition = await createWorktreeDemoWorkflowDefinition(
      options.demoRoot,
    );
    const run = activeRunner.createWorkflow(definition);
    await activeRunner.flush();

    await appendAuditEvent({
      type: "workflow.created",
      actor: "operator",
      workflowId: run.id,
      metadata: {
        source: "worktree-demo",
      },
    });

    return reply.code(201).send(run);
  });

  app.post("/workflows/agent-demo", async (_request, reply) => {
    const definition = await createAgentDemoWorkflowDefinition(
      options.demoRoot,
    );
    const run = activeRunner.createWorkflow(definition);
    await activeRunner.flush();

    await appendAuditEvent({
      type: "workflow.created",
      actor: "operator",
      workflowId: run.id,
      metadata: {
        source: "agent-demo",
      },
    });

    return reply.code(201).send(run);
  });

  app.post("/workflows/repository", async (request, reply) => {
    const parsed = createRepositoryWorkflowRequestSchema.safeParse(
      request.body,
    );

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_repository_workflow_request",
        issues: parsed.error.issues,
      });
    }

    try {
      const repository = parsed.data.repositoryId
        ? await repositoryStore.get(parsed.data.repositoryId)
        : undefined;

      if (parsed.data.repositoryId && !repository) {
        return reply.code(404).send({ error: "repository_not_found" });
      }

      const repositoryPath = repository?.path ?? parsed.data.repositoryPath;
      if (!repositoryPath) {
        return reply.code(400).send({
          error: "repository_path_required",
        });
      }

      if (!isRepositoryPathAllowed(repositoryPath, allowedRepositoryRoots)) {
        return reply.code(403).send({
          error: "repository_path_not_allowed",
          message: "Repository path is outside MAWO_ALLOWED_REPOSITORY_ROOTS.",
        });
      }

      const definition = await createRepositoryWorkflowDefinition(
        {
          ...parsed.data,
          repositoryPath,
          qualityGates:
            parsed.data.qualityGates.length > 0
              ? parsed.data.qualityGates
              : (repository?.qualityGates ?? []),
        },
        {
          root,
        },
      );
      const run = activeRunner.createWorkflow(definition);
      await activeRunner.flush();

      await appendAuditEvent({
        type: "workflow.created",
        actor: "operator",
        workflowId: run.id,
        metadata: {
          source: "repository",
          repositoryId: run.repositoryId ?? "",
          repositoryPath: run.repositoryPath ?? "",
        },
      });

      return reply.code(201).send(run);
    } catch (error) {
      if (error instanceof RepositoryNotReadyError) {
        return reply.code(422).send({
          error: "repository_not_ready",
          message: error.message,
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
        issues: parsed.error.issues,
      });
    }

    await activeRunner.refreshFromStore();
    if (!activeRunner.getWorkflow(request.params.id)) {
      return reply.code(404).send({ error: "workflow_not_found" });
    }

    try {
      const run = activeRunner.reviewWorkflow(request.params.id, parsed.data);
      await activeRunner.flush();

      await appendAuditEvent({
        type: "workflow.reviewed",
        actor: "operator",
        workflowId: run.id,
        metadata: {
          decision: run.review?.decision ?? parsed.data.decision,
        },
      });

      return run;
    } catch (error) {
      if (error instanceof WorkflowNotReviewReadyError) {
        return reply.code(409).send({
          error: "workflow_not_review_ready",
          message: error.message,
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
        request.params.id,
      );
      await activeRunner.flush();

      await appendAuditEvent({
        type: "workflow.workspaces_cleaned",
        actor: "operator",
        workflowId: cleanup.workflowId,
        metadata: {
          status: cleanup.status,
          cleanedCount: String(cleanup.cleaned.length),
          cleanedTaskIds: cleanup.cleaned.map((item) => item.taskId).join(","),
          cleanedBranches: cleanup.cleaned.map((item) => item.branch).join(","),
          cleanedPaths: cleanup.cleaned.map((item) => item.path).join(","),
        },
      });

      return cleanup;
    } catch (error) {
      if (error instanceof WorkflowWorkspacesNotCleanableError) {
        return reply.code(409).send({
          error: "workflow_workspaces_not_cleanable",
          message: error.message,
        });
      }

      throw error;
    }
  });

  app.get<{
    Params: { id: string };
  }>("/workflows/:id", async (request, reply) => {
    await activeRunner.refreshFromStore();
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
      const run = await activeRunner.runWorkflow(request.params.id);
      await activeRunner.flush();
      return run;
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
      const retry = await activeRunner.retryWorkflowWithResult(
        request.params.id,
      );
      const run = retry.run;
      await activeRunner.flush();

      await appendAuditEvent({
        type: "workflow.retry_requested",
        actor: "operator",
        workflowId: run.id,
        metadata: {
          previousStatus: retry.previousStatus,
          status: run.status,
          cleanedCount: String(retry.cleanedWorkspaces.length),
          cleanedTaskIds: retry.cleanedWorkspaces
            .map((item) => item.taskId)
            .join(","),
          cleanedBranches: retry.cleanedWorkspaces
            .map((item) => item.branch)
            .join(","),
          cleanedPaths: retry.cleanedWorkspaces
            .map((item) => item.path)
            .join(","),
        },
      });

      return run;
    } catch (error) {
      if (error instanceof WorkflowNotRetryableError) {
        return reply.code(409).send({
          error: "workflow_not_retryable",
          message: error.message,
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
      const job = await queue.enqueue(request.params.id);
      await queue.flush();

      await appendAuditEvent({
        type: "workflow.enqueued",
        actor: "operator",
        workflowId: job.workflowId,
        jobId: job.id,
        metadata: {
          repositoryId: workflow.repositoryId ?? "",
          repositoryPath: workflow.repositoryPath ?? "",
          status: job.status,
        },
      });

      return reply.code(202).send(job);
    } catch (error) {
      if (error instanceof WorkflowAlreadyRunningError) {
        return reply.code(409).send({
          error: "workflow_already_running",
          message: error.message,
          job: error.job,
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
        allowedStatuses: workflowJobStatusSchema.options,
      });
    }

    const jobs = (await queue.listJobs()).filter((job) => {
      if (jobStatus?.data && job.status !== jobStatus.data) {
        return false;
      }

      if (
        request.query.workflowId &&
        job.workflowId !== request.query.workflowId
      ) {
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
    const job = await queue.cancelJob(request.params.id);

    if (!job) {
      return reply.code(404).send({ error: "job_not_found" });
    }

    await queue.flush();
    const workflow = activeRunner.getWorkflow(job.workflowId);
    await syncRequirementsForCanceledJob(job, workflow);
    await appendAuditEvent({
      type: "job.canceled",
      actor: "operator",
      workflowId: job.workflowId,
      jobId: job.id,
      metadata: {
        repositoryId: workflow?.repositoryId ?? "",
        repositoryPath: workflow?.repositoryPath ?? "",
        status: job.status,
      },
    });

    return job;
  });

  app.get<{
    Params: { id: string };
  }>("/jobs/:id/timeline", async (request, reply) => {
    const job = await queue.getJob(request.params.id);

    if (!job) {
      return reply.code(404).send({ error: "job_not_found" });
    }

    const workflow = activeRunner.getWorkflow(job.workflowId);
    const report = workflow ? activeRunner.getReport(workflow.id) : undefined;
    const jobStartedAt = Date.parse(job.createdAt);
    const jobFinishedAt = job.finishedAt
      ? Date.parse(job.finishedAt)
      : undefined;
    const events = (
      await auditStore.list({ workflowId: job.workflowId })
    ).filter((event) => {
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
            repositoryPath: workflow.repositoryPath,
          }
        : undefined,
      summary: report
        ? {
            text: report.summary,
            recommendation: report.recommendation,
            failedTasks: report.failedTasks,
            failedGates: report.failedGates,
          }
        : undefined,
      events,
    };
  });

  app.get<{
    Params: { id: string };
  }>("/jobs/:id", async (request, reply) => {
    const job = await queue.getJob(request.params.id);

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
      workflowArtifactRoot,
    );

    if (!isPathWithin(artifactPath, workflowArtifactRoot)) {
      return reply.code(403).send({
        error: "artifact_path_not_allowed",
        message: "Artifact path is outside this workflow artifact directory.",
      });
    }

    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
      return reply.code(404).send({ error: "artifact_not_found" });
    }

    const sizeBytes = statSync(artifactPath).size;
    const maxBytes = parseArtifactMaxBytes(request.query.maxBytes);
    const truncated = sizeBytes > maxBytes;
    const content = readArtifactPrefix(artifactPath, maxBytes);

    await appendAuditEvent({
      type: "workflow.artifact_read",
      actor:
        identifyAuthRole(request.headers.authorization ?? "") ?? "operator",
      workflowId: request.params.id,
      metadata: {
        artifactPath,
        maxBytes: String(maxBytes),
        sizeBytes: String(sizeBytes),
        truncated: String(truncated),
      },
    });

    return {
      workflowId: request.params.id,
      path: artifactPath,
      content: truncated ? content.slice(0, maxBytes) : content,
      contentType: "text/plain; charset=utf-8",
      sizeBytes,
      maxBytes,
      truncated,
    };
  });

  app.get<{
    Params: { id: string };
  }>("/workflows/:id/merge-candidate", async (request, reply) => {
    try {
      return activeRunner.getMergeCandidate(request.params.id);
    } catch (error) {
      if (error instanceof WorkflowMergeCandidateNotReadyError) {
        return reply.code(409).send({
          error: "merge_candidate_not_ready",
          message: error.message,
          status: error.status,
        });
      }

      return reply.code(404).send({ error: "workflow_not_found" });
    }
  });

  app.post<{
    Params: { id: string };
  }>("/workflows/:id/merge-candidate/apply", async (request, reply) => {
    try {
      const result = await activeRunner.applyMergeCandidate(request.params.id);

      await appendAuditEvent({
        type: "workflow.merge_candidate_applied",
        actor: "operator",
        workflowId: result.workflowId,
        metadata: {
          status: result.status,
          repositoryPath: result.repositoryPath,
          sourceBranches: result.sourceBranches.join(","),
          patchArtifactPath: result.patchArtifactPath ?? "",
          gitStatus: result.gitStatus,
        },
      });

      return result;
    } catch (error) {
      if (error instanceof WorkflowMergeCandidateNotReadyError) {
        return reply.code(409).send({
          error: "merge_candidate_not_ready",
          message: error.message,
          status: error.status,
        });
      }

      if (error instanceof WorkflowMergeCandidateApplyBlockedError) {
        return reply.code(409).send({
          error: "merge_candidate_apply_blocked",
          reason: error.reason,
          message: error.message,
          detail: error.detail,
        });
      }

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

function isRepositoryPathAllowed(
  path: string,
  allowedRoots: string[],
): boolean {
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

function resolveArtifactPath(
  path: string,
  workflowArtifactRoot: string,
): string {
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

function readLatestLaunchGateEvidence(root: string) {
  const evidenceRoot = join(root, "output", "launch-readiness");

  if (!existsSync(evidenceRoot) || !statSync(evidenceRoot).isDirectory()) {
    return undefined;
  }

  const latestAlias = join(evidenceRoot, "latest.json");
  const latestPath =
    existsSync(latestAlias) && statSync(latestAlias).isFile()
      ? latestAlias
      : readdirSync(evidenceRoot, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() &&
              /^\d{4}-\d{2}-\d{2}T.+\.json$/.test(entry.name),
          )
          .map((entry) => join(evidenceRoot, entry.name))
          .sort((left, right) => left.localeCompare(right))
          .at(-1);

  if (!latestPath) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(latestPath, "utf8")) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Launch gate evidence JSON must be an object.");
  }

  const evidence = launchGateEvidenceSchema.parse({
    ...parsed,
    sourcePath: latestPath,
  });
  const currentGit = readCurrentGitContext(root);

  if (!currentGit) {
    return evidence;
  }

  const staleReasons = buildLaunchGateStaleReasons({
    evidenceBranch: evidence.branch,
    evidenceCommit: evidence.commit,
    evidenceDirtyFiles: evidence.dirtyFiles,
    currentBranch: currentGit.branch,
    currentCommit: currentGit.commit,
    currentDirtyFiles: currentGit.dirtyFiles,
  });

  return launchGateEvidenceSchema.parse({
    ...evidence,
    currentBranch: currentGit.branch,
    currentCommit: currentGit.commit,
    currentDirtyFiles: currentGit.dirtyFiles,
    fresh: staleReasons.length === 0,
    staleReasons,
  });
}

function readCurrentGitContext(root: string):
  | {
      branch: string;
      commit: string;
      dirtyFiles: string[];
    }
  | undefined {
  const branch = readGitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = readGitValue(root, ["rev-parse", "--short", "HEAD"]);

  if (!branch || !commit) {
    return undefined;
  }

  const dirtyFiles = (readGitValue(root, ["status", "--short"]) ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    branch,
    commit,
    dirtyFiles,
  };
}

function readGitValue(root: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return undefined;
  }

  return result.stdout.trim() || undefined;
}

function buildLaunchGateStaleReasons(input: {
  evidenceBranch: string;
  evidenceCommit: string;
  evidenceDirtyFiles: string[];
  currentBranch: string;
  currentCommit: string;
  currentDirtyFiles: string[];
}): string[] {
  const reasons: string[] = [];

  if (input.evidenceBranch !== input.currentBranch) {
    reasons.push(
      `Evidence branch ${input.evidenceBranch} does not match current branch ${input.currentBranch}.`,
    );
  }

  if (input.evidenceCommit !== input.currentCommit) {
    reasons.push(
      `Evidence commit ${input.evidenceCommit} does not match HEAD ${input.currentCommit}.`,
    );
  }

  if (input.evidenceDirtyFiles.length > 0) {
    reasons.push("Evidence was generated while the working tree was dirty.");
  }

  if (input.currentDirtyFiles.length > 0) {
    reasons.push("Current working tree is dirty; rerun launch gate after committing.");
  }

  return reasons;
}

function createWritableDirectoryCheck(id: string, label: string, path: string) {
  try {
    mkdirSync(path, { recursive: true });
    const probePath = join(
      path,
      `.readiness-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    );
    const file = openSync(probePath, "w");
    closeSync(file);
    unlinkSync(probePath);

    return {
      id,
      label,
      ok: true,
      status: "ready",
      path,
    };
  } catch (error) {
    return {
      id,
      label,
      ok: false,
      status: "failed",
      path,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function createGitCliCheck() {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const version = result.stdout.trim();

  if (result.status === 0) {
    return {
      id: "git_cli",
      label: "Git CLI",
      ok: true,
      status: "ready",
      version,
    };
  }

  return {
    id: "git_cli",
    label: "Git CLI",
    ok: false,
    status: "failed",
    message: result.stderr.trim() || "git --version failed",
  };
}

function createProductionConfigCheck(input: {
  deploymentMode: "development" | "production";
  apiToken?: string;
  allowedRepositoryRoots: string[];
}) {
  const missing =
    input.deploymentMode === "production"
      ? [
          !isProductionApiToken(input.apiToken) ? "MAWO_API_TOKEN" : undefined,
          input.allowedRepositoryRoots.length === 0
            ? "MAWO_ALLOWED_REPOSITORY_ROOTS"
            : undefined,
        ].filter((item): item is string => Boolean(item))
      : [];
  const ok = missing.length === 0;

  return {
    id: "production_config",
    label: "Production security config",
    ok,
    status: ok ? "ready" : "blocked",
    deploymentMode: input.deploymentMode,
    protectedByToken: Boolean(input.apiToken),
    allowedRepositoryRootsConfigured: input.allowedRepositoryRoots.length > 0,
    missing,
  };
}

function createDeploymentTopologyCheck(input: {
  deploymentMode: "development" | "production";
  apiReplicaCount: number;
  stateBackend: "file" | "postgres";
  queueBackend: ActiveQueueBackend;
}) {
  const maxSupportedApiReplicas =
    input.stateBackend === "postgres" && input.queueBackend === "postgres"
      ? Number.MAX_SAFE_INTEGER
      : 1;

  if (!Number.isInteger(input.apiReplicaCount) || input.apiReplicaCount < 1) {
    return {
      id: "deployment_topology",
      label: "Deployment topology",
      ok: false,
      status: "blocked",
      deploymentMode: input.deploymentMode,
      apiReplicaCount: input.apiReplicaCount,
      maxSupportedApiReplicas,
      stateBackend: input.stateBackend,
      queueBackend: input.queueBackend,
      message: "MAWO_API_REPLICA_COUNT must be a positive integer.",
    };
  }

  const scaledPastRuntimeLimit =
    input.deploymentMode === "production" &&
    input.apiReplicaCount > maxSupportedApiReplicas;

  return {
    id: "deployment_topology",
    label: "Deployment topology",
    ok: !scaledPastRuntimeLimit,
    status: scaledPastRuntimeLimit ? "blocked" : "ready",
    deploymentMode: input.deploymentMode,
    apiReplicaCount: input.apiReplicaCount,
    maxSupportedApiReplicas,
    stateBackend: input.stateBackend,
    queueBackend: input.queueBackend,
    message: scaledPastRuntimeLimit
      ? "The active queue backend supports one API replica. Set MAWO_API_REPLICA_COUNT=1 or migrate the state and queue backends before scaling."
      : "Runtime topology is compatible with the configured API replica count.",
  };
}

function createRuntimeBackendCheck(input: {
  requestedStateBackend: string;
  requestedQueueBackend: string;
  activeStateBackend: "file" | "postgres";
  activeQueueBackend: ActiveQueueBackend;
  maxConcurrentJobs: number;
  databaseUrlConfigured: boolean;
  redisUrlConfigured: boolean;
}) {
  const unsupported = [
    input.requestedStateBackend !== input.activeStateBackend
      ? `MAWO_STATE_BACKEND=${input.requestedStateBackend}`
      : undefined,
    input.requestedQueueBackend !== input.activeQueueBackend
      ? `MAWO_QUEUE_BACKEND=${input.requestedQueueBackend}`
      : undefined,
  ].filter((item): item is string => Boolean(item));
  const ok = unsupported.length === 0;

  return {
    id: "runtime_backend",
    label: "Runtime backend",
    ok,
    status: ok ? "ready" : "blocked",
    requestedStateBackend: input.requestedStateBackend,
    activeStateBackend: input.activeStateBackend,
    requestedQueueBackend: input.requestedQueueBackend,
    activeQueueBackend: input.activeQueueBackend,
    maxConcurrentJobs: input.maxConcurrentJobs,
    databaseUrlConfigured: input.databaseUrlConfigured,
    redisUrlConfigured: input.redisUrlConfigured,
    unsupported,
    message: ok
      ? `Using ${input.activeStateBackend} state and ${input.activeQueueBackend} queue with max ${input.maxConcurrentJobs} concurrent workflow job${input.maxConcurrentJobs === 1 ? "" : "s"}.`
      : `Requested runtime backend is not active yet: ${unsupported.join(", ")}. Keep unsupported backends on implemented values before rollout.`,
  };
}

type WorkerHealth = {
  workerId: string;
  healthy: boolean;
  status: string;
  lastSeenAt: string;
  ageMs: number;
  workflowId?: string;
  jobId?: string;
  lastJobStatus?: string;
};

type WorkerHealthResponse = {
  ok: boolean;
  checkedAt: string;
  staleAfterMs: number;
  summary: {
    totalWorkers: number;
    healthyWorkers: number;
    staleWorkers: number;
  };
  workers: WorkerHealth[];
};

function createWorkerHealth(
  events: AuditEvent[],
  staleAfterMs: number,
  checkedAt: Date = new Date(),
): WorkerHealthResponse {
  const latestByWorker = new Map<string, AuditEvent>();

  for (const event of events) {
    const workerId = event.metadata?.workerId;

    if (!workerId) {
      continue;
    }

    const existing = latestByWorker.get(workerId);

    if (
      !existing ||
      Date.parse(existing.createdAt) <= Date.parse(event.createdAt)
    ) {
      latestByWorker.set(workerId, event);
    }
  }

  const checkedAtMs = checkedAt.getTime();
  const workers = [...latestByWorker.entries()]
    .map(([workerId, event]) => {
      const seenAtMs = Date.parse(event.createdAt);
      const ageMs = Number.isFinite(seenAtMs)
        ? Math.max(0, checkedAtMs - seenAtMs)
        : Number.MAX_SAFE_INTEGER;
      const healthy = ageMs <= staleAfterMs;

      return {
        workerId,
        healthy,
        status: event.metadata?.status ?? "unknown",
        lastSeenAt: event.createdAt,
        ageMs,
        ...(event.workflowId ? { workflowId: event.workflowId } : {}),
        ...(event.jobId ? { jobId: event.jobId } : {}),
        ...(event.metadata?.lastJobStatus
          ? { lastJobStatus: event.metadata.lastJobStatus }
          : {}),
      };
    })
    .sort((left, right) => left.workerId.localeCompare(right.workerId));
  const healthyWorkers = workers.filter((worker) => worker.healthy).length;
  const staleWorkers = workers.length - healthyWorkers;

  return {
    ok: healthyWorkers > 0,
    checkedAt: checkedAt.toISOString(),
    staleAfterMs,
    summary: {
      totalWorkers: workers.length,
      healthyWorkers,
      staleWorkers,
    },
    workers,
  };
}

function createWorkerHealthCheck(input: {
  queueBackend: ActiveQueueBackend;
  workerHealth: WorkerHealthResponse;
}) {
  const required = input.queueBackend === "postgres";
  const ok = !required || input.workerHealth.summary.healthyWorkers > 0;

  return {
    id: "workers",
    label: "Worker health",
    ok,
    status: ok ? "ready" : "blocked",
    required,
    staleAfterMs: input.workerHealth.staleAfterMs,
    healthyWorkers: input.workerHealth.summary.healthyWorkers,
    staleWorkers: input.workerHealth.summary.staleWorkers,
    totalWorkers: input.workerHealth.summary.totalWorkers,
    message: ok
      ? required
        ? "At least one Postgres workflow worker is reporting a fresh heartbeat."
        : "External workers are optional for the active queue backend."
      : "Postgres queue backend requires at least one fresh workflow worker heartbeat.",
  };
}

function hasCurrentRequirementReport(workflow: WorkflowRun): boolean {
  return (
    workflow.status === "gate_failed" ||
    workflow.status === "needs_review" ||
    workflow.status === "completed" ||
    workflow.status === "aborted" ||
    workflow.status === "archived" ||
    workflow.status === "failed"
  );
}

function hasCurrentRequirementMergeCandidate(workflow: WorkflowRun): boolean {
  return workflow.status === "needs_review" || workflow.status === "completed";
}

function isProductionApiToken(apiToken?: string): boolean {
  if (!apiToken) {
    return false;
  }

  if (apiToken === "change-me-before-production") {
    return false;
  }

  return apiToken.length >= 20;
}

function parseApiReplicaCount(value?: string): number {
  if (!value?.trim()) {
    return 1;
  }

  return Number(value);
}

function parseMaxConcurrentJobs(value?: string): number {
  if (!value?.trim()) {
    return 1;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.floor(parsed));
}

function parseWorkerStaleAfterMs(value?: string): number {
  if (!value?.trim()) {
    return 60_000;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 60_000;
  }

  return Math.max(1_000, Math.floor(parsed));
}

function parseRuntimeBackend(
  value: string | undefined,
  fallback: "file" | "in_process",
): string {
  const normalized = value?.trim().toLowerCase().replace("-", "_");

  return normalized || fallback;
}
