"use client";

import {
  requirementDeliveryTicketSchema,
  workflowRunSchema,
  workflowJobSchema,
  type RequirementDeliveryTicket,
  type WorkflowJob,
  type WorkflowRun,
  type WorkflowJobStatus
} from "@mawo/shared";
import { useEffect, useRef, useState } from "react";
import {
  buildApiHeaders,
  formatApiErrorMessage,
  normalizeApiTokenRole
} from "../api-auth";
import {
  buildDeliveryConsoleModel,
  type DeliveryConsoleModel,
  type RequirementLifecycleAction,
  type RequirementReviewAction
} from "./delivery-console-model";
import {
  buildDeliveryTopbarHealthIndicators,
  type DeliveryTopbarHealthIndicator
} from "./delivery-topbar-health";
import type { NewRequirementPayload } from "./new-requirement-payload";
import { RequirementDeliveryConsole } from "./requirement-delivery-console";
import { loadLatestLaunchGateEvidence } from "./launch-gate-evidence-loader";
import { loadRequirementDeliveryModel } from "./requirement-delivery-loader";
import { buildWorkflowReviewPayload } from "../workflow-review-payload";
import { loadOperationsSnapshot } from "../operations-snapshot";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
const apiTokenStorageKey = "mawo-api-token";
const apiTokenRoleStorageKey = "mawo-api-token-role";
const activeJobPollIntervalMs = 1500;
const retryResetMessage =
  "Retry reset to ready. Enqueue to run fresh evidence.";

type LoadState = "loading" | "ready" | "error";
type TrackedRequirementJob = {
  jobId: string;
  workflowId: string;
  status: WorkflowJobStatus;
};

export function RequirementDeliveryConsoleClient() {
  const [model, setModel] = useState<DeliveryConsoleModel>(() =>
    buildDeliveryConsoleModel([])
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("Loading requirement tickets");
  const [viewerMode, setViewerMode] = useState(false);
  const [topbarHealthIndicators, setTopbarHealthIndicators] = useState<
    DeliveryTopbarHealthIndicator[]
  >([]);
  const [jobStatusByRequirementId, setJobStatusByRequirementId] = useState<
    Record<string, WorkflowJobStatus | undefined>
  >({});
  const [activeJobsByRequirementId, setActiveJobsByRequirementId] = useState<
    Record<string, TrackedRequirementJob | undefined>
  >({});
  const [workflowOverridesById, setWorkflowOverridesById] = useState<
    Record<string, WorkflowRun | undefined>
  >({});
  const hasReportedInitialLoadRef = useRef(false);

  async function api(path: string, init?: RequestInit): Promise<unknown> {
    const token =
      typeof window === "undefined"
        ? undefined
        : (window.localStorage.getItem(apiTokenStorageKey) ?? undefined);
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: buildApiHeaders(token, init?.headers)
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;

    if (!response.ok) {
      throw new ApiResponseError(response.status, path, body);
    }

    return body;
  }

  async function handleNewRequirementSubmit(payload: NewRequirementPayload) {
    const createdRequirement = requirementDeliveryTicketSchema.parse(
      await api("/requirements", {
        method: "POST",
        body: JSON.stringify(payload)
      })
    );

    const nextModel = await loadRequirementDeliveryModel(
      api,
      {},
      {
        jobStatusByRequirementId,
        workflowOverrides: buildWorkflowOverrides(workflowOverridesById)
      }
    );
    setModel(nextModel);
    setLoadState("ready");
    setMessage(`Requirement draft saved: ${payload.title}`);
    return createdRequirement.id;
  }

  async function handleRequirementLifecycleAction(
    requirementId: string,
    action: RequirementLifecycleAction
  ) {
    const result = await api(`/requirements/${requirementId}/${action}`, {
      method: "POST"
    });
    const lifecycleResult = parseRequirementLifecycleResult(result);
    const nextJobStatusByRequirementId = {
      ...jobStatusByRequirementId,
      [requirementId]: lifecycleResult.jobStatus
    };
    const nextActiveJobsByRequirementId = { ...activeJobsByRequirementId };

    if (action === "enqueue" && lifecycleResult.job) {
      nextActiveJobsByRequirementId[requirementId] = {
        jobId: lifecycleResult.job.id,
        workflowId: lifecycleResult.job.workflowId,
        status: lifecycleResult.job.status
      };
    } else {
      delete nextJobStatusByRequirementId[requirementId];
      delete nextActiveJobsByRequirementId[requirementId];
    }

    const nextWorkflowOverridesById = lifecycleResult.workflow
      ? {
          ...workflowOverridesById,
          [lifecycleResult.workflow.id]: lifecycleResult.workflow
        }
      : workflowOverridesById;

    if (lifecycleResult.workflow) {
      setWorkflowOverridesById(nextWorkflowOverridesById);
    }

    const nextModel = await loadRequirementDeliveryModel(
      api,
      {},
      {
        jobStatusByRequirementId: nextJobStatusByRequirementId,
        workflowOverrides: buildWorkflowOverrides(nextWorkflowOverridesById)
      }
    );
    setModel(nextModel);
    setLoadState("ready");
    setMessage(buildLifecycleMessage(action, lifecycleResult.requirement));
    setJobStatusByRequirementId(nextJobStatusByRequirementId);
    setActiveJobsByRequirementId(nextActiveJobsByRequirementId);
  }

  async function handleRequirementReviewAction(
    requirementId: string,
    workflowRunId: string,
    action: RequirementReviewAction
  ) {
    const result = await api(`/workflows/${workflowRunId}/review`, {
      method: "POST",
      body: JSON.stringify(buildWorkflowReviewPayload(action))
    });
    const workflow = workflowRunSchema.parse(result);
    const nextWorkflowOverridesById = {
      ...workflowOverridesById,
      [workflow.id]: workflow
    };

    setWorkflowOverridesById(nextWorkflowOverridesById);
    const nextModel = await loadRequirementDeliveryModel(
      api,
      {},
      {
        jobStatusByRequirementId,
        workflowOverrides: buildWorkflowOverrides(nextWorkflowOverridesById)
      }
    );
    setModel(nextModel);
    setLoadState("ready");
    setMessage(buildReviewMessage(action, requirementId, nextModel));
  }

  useEffect(() => {
    const activeEntries = Object.entries(activeJobsByRequirementId).flatMap(
      ([requirementId, job]) =>
        job && isActiveJobStatus(job.status)
          ? ([[requirementId, job]] satisfies Array<
              [string, TrackedRequirementJob]
            >)
          : []
    );

    if (!activeEntries.length) {
      return;
    }

    let canceled = false;
    let inFlight = false;

    async function pollActiveJobs() {
      if (inFlight) {
        return;
      }

      inFlight = true;
      const nextActiveJobsByRequirementId = { ...activeJobsByRequirementId };
      const nextJobStatusByRequirementId = { ...jobStatusByRequirementId };
      const settledRequirementIds: string[] = [];
      let shouldReloadModel = false;
      let shouldUpdateJobState = false;

      try {
        await Promise.all(
          activeEntries.map(async ([requirementId, trackedJob]) => {
            const job = workflowJobSchema.parse(
              await api(`/jobs/${encodeURIComponent(trackedJob.jobId)}`)
            );

            if (isActiveJobStatus(job.status)) {
              nextActiveJobsByRequirementId[requirementId] = {
                jobId: job.id,
                workflowId: job.workflowId,
                status: job.status
              };
              nextJobStatusByRequirementId[requirementId] = job.status;
              shouldUpdateJobState =
                shouldUpdateJobState || trackedJob.status !== job.status;
              return;
            }

            delete nextActiveJobsByRequirementId[requirementId];
            delete nextJobStatusByRequirementId[requirementId];
            settledRequirementIds.push(requirementId);
            shouldUpdateJobState = true;
            shouldReloadModel = true;
          })
        );

        if (canceled) {
          return;
        }

        if (shouldReloadModel) {
          const nextModel = await loadRequirementDeliveryModel(
            api,
            {},
            {
              jobStatusByRequirementId: nextJobStatusByRequirementId,
              workflowOverrides: buildWorkflowOverrides(workflowOverridesById)
            }
          );

          if (canceled) {
            return;
          }

          setModel(nextModel);
          setLoadState("ready");
          setMessage(
            buildSettledExecutionMessage(settledRequirementIds, nextModel)
          );
        }

        if (shouldUpdateJobState) {
          setActiveJobsByRequirementId(nextActiveJobsByRequirementId);
          setJobStatusByRequirementId(nextJobStatusByRequirementId);
        }
      } catch (error: unknown) {
        if (canceled) {
          return;
        }

        setLoadState("error");
        setMessage(
          error instanceof Error ? error.message : "Active job refresh failed"
        );
      } finally {
        inFlight = false;
      }
    }

    const firstPoll = window.setTimeout(pollActiveJobs, 250);
    const interval = window.setInterval(
      pollActiveJobs,
      activeJobPollIntervalMs
    );

    return () => {
      canceled = true;
      window.clearTimeout(firstPoll);
      window.clearInterval(interval);
    };
  }, [activeJobsByRequirementId, jobStatusByRequirementId, workflowOverridesById]);

  useEffect(() => {
    let canceled = false;

    async function loadDeliveryModel() {
      const role = normalizeApiTokenRole(
        window.localStorage.getItem(apiTokenRoleStorageKey)
      );

      if (!canceled) {
        setViewerMode(role === "viewer");
      }

      try {
        const nextModel = await loadRequirementDeliveryModel(
          api,
          {},
          {
            jobStatusByRequirementId,
            workflowOverrides: buildWorkflowOverrides(workflowOverridesById)
          }
        );
        if (canceled) {
          return;
        }

        setModel(nextModel);
        setLoadState("ready");
        if (!hasReportedInitialLoadRef.current) {
          setMessage(
            `${nextModel.requirements.length} requirement tickets loaded`
          );
          hasReportedInitialLoadRef.current = true;
        }
      } catch (error: unknown) {
        if (canceled) {
          return;
        }

        setLoadState("error");
        setMessage(
          error instanceof Error ? error.message : "Load workflow runs failed"
        );
      }
    }

    void loadDeliveryModel();

    return () => {
      canceled = true;
    };
  }, [jobStatusByRequirementId, workflowOverridesById]);

  useEffect(() => {
    let canceled = false;

    async function loadTopbarHealthIndicators() {
      try {
        const [snapshot, launchEvidence] = await Promise.all([
          loadOperationsSnapshot(api),
          loadLatestLaunchGateEvidence(api)
        ]);
        if (canceled) {
          return;
        }

        setTopbarHealthIndicators(
          buildDeliveryTopbarHealthIndicators(snapshot, launchEvidence)
        );
      } catch {
        if (canceled) {
          return;
        }

        setTopbarHealthIndicators([]);
      }
    }

    void loadTopbarHealthIndicators();

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <RequirementDeliveryConsole
      model={model}
      syncMessage={message}
      syncTone={loadState === "error" ? "danger" : "muted"}
      topbarHealthIndicators={topbarHealthIndicators}
      viewerMode={viewerMode}
      onRequirementLifecycleAction={handleRequirementLifecycleAction}
      onRequirementReviewAction={handleRequirementReviewAction}
      onNewRequirementSubmit={handleNewRequirementSubmit}
    />
  );
}

class ApiResponseError extends Error {
  constructor(status: number, path: string, body: unknown) {
    super(formatApiErrorMessage(status, path, body));
    this.name = "ApiResponseError";
  }
}

function buildSettledExecutionMessage(
  requirementIds: string[],
  model: DeliveryConsoleModel
): string {
  const titles = [
    ...new Set(
      requirementIds.flatMap((requirementId) => {
        const title = model.requirements.find(
          (requirement) => requirement.id === requirementId
        )?.title;

        return title ? [title] : [];
      })
    )
  ];

  return titles.length
    ? `Requirement execution settled; evidence refreshed: ${titles.join(", ")}`
    : "Requirement execution settled; evidence refreshed";
}

function parseRequirementLifecycleResult(value: unknown): {
  job?: WorkflowJob;
  jobStatus?: WorkflowJobStatus;
  requirement?: RequirementDeliveryTicket;
  workflow?: WorkflowRun;
} {
  const directRequirement = requirementDeliveryTicketSchema.safeParse(value);
  if (directRequirement.success) {
    return { requirement: directRequirement.data };
  }

  if (!value || typeof value !== "object") {
    return {};
  }

  const result = value as {
    job?: unknown;
    requirement?: unknown;
    workflow?: unknown;
  };
  const requirement = requirementDeliveryTicketSchema.safeParse(
    result.requirement
  );
  const job = workflowJobSchema.safeParse(result.job);
  const workflow = workflowRunSchema.safeParse(result.workflow);

  return {
    job: job.success ? job.data : undefined,
    jobStatus: job.success ? job.data.status : undefined,
    requirement: requirement.success ? requirement.data : undefined,
    workflow: workflow.success ? workflow.data : undefined
  };
}

function isActiveJobStatus(status: WorkflowJobStatus): boolean {
  return status === "queued" || status === "running";
}

function buildWorkflowOverrides(
  overridesById: Record<string, WorkflowRun | undefined>
): WorkflowRun[] {
  return Object.values(overridesById).filter(
    (workflow): workflow is WorkflowRun => Boolean(workflow)
  );
}

function buildLifecycleMessage(
  action: RequirementLifecycleAction,
  requirement?: RequirementDeliveryTicket
): string {
  const title = requirement?.title ?? "Requirement";

  switch (action) {
    case "confirm-plan":
      return `Plan confirmed: ${title}`;
    case "enqueue":
      return `Requirement enqueued: ${title}`;
    case "retry":
      return `${retryResetMessage} ${title}`;
  }
}

function buildReviewMessage(
  action: RequirementReviewAction,
  requirementId: string,
  model: DeliveryConsoleModel
): string {
  const title =
    model.requirements.find((requirement) => requirement.id === requirementId)
      ?.title ?? "Requirement";

  return action === "approve"
    ? `Review approved: ${title}`
    : `Review rejected: ${title}`;
}
