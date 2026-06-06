import type { WorkerHealth, WorkerHealthResponse } from "@mawo/shared";

export type WorkerHealthSeverity = "healthy" | "warning" | "danger" | "neutral";

export type WorkerHealthSummaryDisplay = {
  statusLabel: string;
  severity: WorkerHealthSeverity;
  total: number;
  healthy: number;
  stale: number;
  running: number;
  staleAfterLabel: string;
};

export type WorkerHealthDisplay = {
  workerId: string;
  healthLabel: string;
  statusLabel: string;
  severity: WorkerHealthSeverity;
  lastSeenAt: string;
  ageLabel: string;
  workflowLabel?: string;
  jobLabel?: string;
  detail: string;
};

export function summarizeWorkerHealth(
  health: WorkerHealthResponse
): WorkerHealthSummaryDisplay {
  const running = health.workers.filter(
    (worker) => worker.healthy && worker.status === "running"
  ).length;

  return {
    statusLabel: health.ok
      ? "Healthy"
      : health.summary.totalWorkers > 0
        ? "Degraded"
        : "No Workers",
    severity: health.ok
      ? "healthy"
      : health.summary.totalWorkers > 0
        ? "warning"
        : "danger",
    total: health.summary.totalWorkers,
    healthy: health.summary.healthyWorkers,
    stale: health.summary.staleWorkers,
    running,
    staleAfterLabel: `${formatDuration(health.staleAfterMs)} stale window`
  };
}

export function buildWorkerHealthDisplay(
  health: WorkerHealthResponse
): WorkerHealthDisplay[] {
  return health.workers.map((worker) => {
    const workflowLabel = shortId(worker.workflowId);
    const jobLabel = shortId(worker.jobId);

    return {
      workerId: worker.workerId,
      healthLabel: worker.healthy ? "Healthy" : "Stale",
      statusLabel: titleCase(worker.status),
      severity: worker.healthy ? "healthy" : "danger",
      lastSeenAt: worker.lastSeenAt,
      ageLabel: `${formatDuration(worker.ageMs)} ago`,
      workflowLabel,
      jobLabel,
      detail: buildWorkerDetail(worker, workflowLabel, jobLabel)
    };
  });
}

function buildWorkerDetail(
  worker: WorkerHealth,
  workflowLabel?: string,
  jobLabel?: string
): string {
  if (worker.status === "running" && jobLabel && workflowLabel) {
    return `Running job ${jobLabel} for workflow ${workflowLabel}.`;
  }

  if (worker.lastJobStatus) {
    return `Last job ${worker.lastJobStatus}.`;
  }

  return worker.healthy
    ? "Heartbeat is fresh."
    : "Heartbeat is stale; check the worker process.";
}

function formatDuration(ms: number): string {
  if (ms <= 60_000) {
    return `${Math.max(0, Math.round(ms / 1_000))}s`;
  }

  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m`;
  }

  return `${Math.round(ms / 3_600_000)}h`;
}

function shortId(id?: string): string | undefined {
  if (!id) {
    return undefined;
  }

  const prefixed = /^([a-z]+-)(.+)$/i.exec(id);
  if (prefixed) {
    return `${prefixed[1]}${prefixed[2].slice(0, 5)}`;
  }

  return id.slice(0, 9);
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
