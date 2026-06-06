import type { OperationsSnapshot } from "@mawo/shared";
import { summarizeReadiness } from "../readiness-display";
import { summarizeWorkerHealth } from "../worker-health-display";

export type DeliveryTopbarHealthSeverity =
  | "healthy"
  | "warning"
  | "danger"
  | "neutral";

export type DeliveryTopbarHealthIndicator = {
  id: "api" | "queue" | "worker";
  label: string;
  value: string;
  detail: string;
  severity: DeliveryTopbarHealthSeverity;
};

export function buildDeliveryTopbarHealthIndicators(
  snapshot: OperationsSnapshot,
): DeliveryTopbarHealthIndicator[] {
  const readiness = summarizeReadiness(snapshot.readiness);
  const workerHealth = summarizeWorkerHealth(snapshot.workerHealth);
  const workerCheck = snapshot.readiness.checks.find(
    (check) => check.id === "workers",
  );
  const workerRequired = getBooleanCheckValue(workerCheck, "required");
  const queuedJobs = snapshot.summary.queuedJobs;
  const failedJobs = snapshot.summary.failedJobs;

  return [
    {
      id: "api",
      label: "API",
      value: readiness.statusLabel,
      detail: `${readiness.readyChecks}/${readiness.totalChecks} readiness checks ready`,
      severity: readiness.severity,
    },
    {
      id: "worker",
      label: "Worker",
      value:
        workerHealth.total > 0
          ? `${workerHealth.healthy}/${workerHealth.total}`
          : "No Workers",
      detail:
        workerHealth.total > 0
          ? `${workerHealth.healthy} of ${workerHealth.total} workers healthy`
          : workerCheck?.message ?? "No worker heartbeats",
      severity:
        workerHealth.total > 0
          ? workerHealth.severity
          : buildMissingWorkerSeverity(snapshot, workerRequired),
    },
    {
      id: "queue",
      label: "Queue",
      value: failedJobs > 0 ? `${failedJobs} failed` : String(queuedJobs),
      detail: buildQueueDetail(queuedJobs, failedJobs),
      severity:
        failedJobs > 0 ? "danger" : queuedJobs > 0 ? "warning" : "neutral",
    },
  ];
}

function buildMissingWorkerSeverity(
  snapshot: OperationsSnapshot,
  workerRequired: boolean | undefined,
): DeliveryTopbarHealthSeverity {
  if (workerRequired === true) {
    return "danger";
  }

  if (workerRequired === false || snapshot.workerHealth.ok) {
    return "neutral";
  }

  return "danger";
}

function buildQueueDetail(queuedJobs: number, failedJobs: number): string {
  if (failedJobs > 0) {
    return `${failedJobs} ${pluralize(failedJobs, "failed job")} ${
      failedJobs === 1 ? "needs" : "need"
    } triage`;
  }

  if (queuedJobs > 0) {
    return `${queuedJobs} ${pluralize(queuedJobs, "job")} waiting for workers`;
  }

  return "No queued jobs";
}

function getBooleanCheckValue(
  check: OperationsSnapshot["readiness"]["checks"][number] | undefined,
  key: string,
): boolean | undefined {
  const value = check?.[key];

  return typeof value === "boolean" ? value : undefined;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
