"use client";

import { useEffect, useState } from "react";
import {
  buildApiHeaders,
  formatApiErrorMessage,
  normalizeApiTokenRole
} from "../api-auth";
import {
  buildDeliveryConsoleModel,
  type DeliveryConsoleModel
} from "./delivery-console-model";
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
  const [message, setMessage] = useState("Loading workflow runs");
  const [viewerMode, setViewerMode] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function api(path: string, init?: RequestInit): Promise<unknown> {
      const token = window.localStorage.getItem(apiTokenStorageKey) ?? undefined;
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

    async function loadDeliveryModel() {
      const role = normalizeApiTokenRole(
        window.localStorage.getItem(apiTokenRoleStorageKey)
      );

      if (!canceled) {
        setViewerMode(role === "viewer");
      }

      try {
        const nextModel = await loadRequirementDeliveryModel(api);
        if (canceled) {
          return;
        }

        setModel(nextModel);
        setLoadState("ready");
        setMessage(`${nextModel.requirements.length} workflow runs loaded`);
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
  }, []);

  return (
    <RequirementDeliveryConsole
      model={model}
      syncMessage={message}
      syncTone={loadState === "error" ? "danger" : "muted"}
      viewerMode={viewerMode}
    />
  );
}

class ApiResponseError extends Error {
  constructor(status: number, path: string, body: unknown) {
    super(formatApiErrorMessage(status, path, body));
    this.name = "ApiResponseError";
  }
}
