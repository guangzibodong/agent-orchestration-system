"use client";

import {
  requirementDeliveryTicketSchema,
  workflowRunSchema,
  workflowJobSchema,
  type RequirementDeliveryTicket,
  type WorkflowRun,
  type WorkflowJobStatus
} from "@mawo/shared";
import { useEffect, useState } from "react";
import {
  buildApiHeaders,
  formatApiErrorMessage,
  normalizeApiTokenRole
} from "../api-auth";
import {
  buildDeliveryConsoleModel,
  type DeliveryConsoleModel,
  type RequirementLifecycleAction
} from "./delivery-console-model";
import type { NewRequirementPayload } from "./new-requirement-payload";
import { RequirementDeliveryConsole } from "./requirement-delivery-console";
import { loadRequirementDeliveryModel } from "./requirement-delivery-loader";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
const apiTokenStorageKey = "mawo-api-token";
const apiTokenRoleStorageKey = "mawo-api-token-role";

type LoadState = "loading" | "ready" | "error";

export function RequirementDeliveryConsoleClient() {
  const [model, setModel] = useState<DeliveryConsoleModel>(() =>
    buildDeliveryConsoleModel([])
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("Loading requirement tickets");
  const [viewerMode, setViewerMode] = useState(false);
  const [jobStatusByRequirementId, setJobStatusByRequirementId] = useState<
    Record<string, WorkflowJobStatus | undefined>
  >({});
  const [workflowOverridesById, setWorkflowOverridesById] = useState<
    Record<string, WorkflowRun | undefined>
  >({});

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
    await api("/requirements", {
      method: "POST",
      body: JSON.stringify(payload)
    });

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

    if (action !== "enqueue") {
      delete nextJobStatusByRequirementId[requirementId];
    }

    setJobStatusByRequirementId(nextJobStatusByRequirementId);
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
  }

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
        setMessage(`${nextModel.requirements.length} requirement tickets loaded`);
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

  return (
    <RequirementDeliveryConsole
      model={model}
      syncMessage={message}
      syncTone={loadState === "error" ? "danger" : "muted"}
      viewerMode={viewerMode}
      onRequirementLifecycleAction={handleRequirementLifecycleAction}
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

function parseRequirementLifecycleResult(value: unknown): {
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
    jobStatus: job.success ? job.data.status : undefined,
    requirement: requirement.success ? requirement.data : undefined,
    workflow: workflow.success ? workflow.data : undefined
  };
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
      return `Retry reset to ready: ${title}`;
  }
}
