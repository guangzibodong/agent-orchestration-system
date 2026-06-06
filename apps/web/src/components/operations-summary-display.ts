import type { OperationsSnapshot } from "@mawo/shared";

export type OperationsSummarySeverity =
  | "healthy"
  | "warning"
  | "danger"
  | "neutral";

export type OperationsSummaryCardId =
  | "queued"
  | "running"
  | "failed"
  | "needsReview"
  | "blockedReadiness"
  | "workers";

export type OperationsSummaryCard = {
  id: OperationsSummaryCardId;
  label: string;
  value: string;
  detail: string;
  severity: OperationsSummarySeverity;
};

export function buildOperationsSummaryCards(
  summary: OperationsSnapshot["summary"]
): OperationsSummaryCard[] {
  return [
    {
      id: "queued",
      label: "Queued",
      value: String(summary.queuedJobs),
      detail:
        summary.queuedJobs > 0
          ? `${summary.queuedJobs} ${pluralize(summary.queuedJobs, "job")} waiting for workers`
          : "No queued jobs",
      severity: summary.queuedJobs > 0 ? "warning" : "neutral"
    },
    {
      id: "running",
      label: "Running",
      value: String(summary.runningJobs),
      detail:
        summary.runningJobs > 0
          ? `${summary.runningJobs} ${pluralize(summary.runningJobs, "job")} currently running`
          : "No jobs running",
      severity: summary.runningJobs > 0 ? "healthy" : "neutral"
    },
    {
      id: "failed",
      label: "Failed",
      value: String(summary.failedJobs),
      detail:
        summary.failedJobs > 0
          ? `${summary.failedJobs} ${pluralize(summary.failedJobs, "failed job")} needs triage`
          : "No failed jobs",
      severity: summary.failedJobs > 0 ? "danger" : "healthy"
    },
    {
      id: "needsReview",
      label: "Needs Review",
      value: String(summary.needsReviewWorkflows),
      detail:
        summary.needsReviewWorkflows > 0
          ? `${summary.needsReviewWorkflows} ${pluralize(summary.needsReviewWorkflows, "workflow")} waiting for review`
          : "No workflows waiting for review",
      severity: summary.needsReviewWorkflows > 0 ? "warning" : "healthy"
    },
    {
      id: "blockedReadiness",
      label: "Readiness Blocks",
      value: String(summary.blockedReadinessChecks),
      detail:
        summary.blockedReadinessChecks > 0
          ? `${summary.blockedReadinessChecks} ${pluralize(summary.blockedReadinessChecks, "readiness check")} blocked`
          : "No readiness checks blocked",
      severity: summary.blockedReadinessChecks > 0 ? "danger" : "healthy"
    },
    {
      id: "workers",
      label: "Workers",
      value: `${summary.healthyWorkers}/${summary.totalWorkers}`,
      detail:
        summary.totalWorkers > 0
          ? `${summary.healthyWorkers} of ${summary.totalWorkers} ${pluralize(summary.totalWorkers, "worker")} healthy`
          : "No worker heartbeats",
      severity: workerSeverity(summary)
    }
  ];
}

function workerSeverity(
  summary: OperationsSnapshot["summary"]
): OperationsSummarySeverity {
  if (summary.totalWorkers === 0 || summary.healthyWorkers === 0) {
    return "danger";
  }

  return summary.healthyWorkers >= summary.totalWorkers ? "healthy" : "warning";
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
