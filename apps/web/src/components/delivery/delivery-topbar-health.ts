import type { LaunchGateEvidence, OperationsSnapshot } from "@mawo/shared";
import { summarizeReadiness } from "../readiness-display";
import { summarizeWorkerHealth } from "../worker-health-display";

export type DeliveryTopbarHealthSeverity =
  | "healthy"
  | "warning"
  | "danger"
  | "neutral";

export type DeliveryTopbarHealthIndicator = {
  id: "api" | "launch" | "queue" | "worker";
  label: string;
  value: string;
  detail: string;
  severity: DeliveryTopbarHealthSeverity;
};

export function buildDeliveryTopbarHealthIndicators(
  snapshot: OperationsSnapshot,
  launchEvidence?: LaunchGateEvidence,
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
      id: "launch",
      label: "Launch",
      value: buildLaunchValue(readiness, launchEvidence),
      detail: buildLaunchDetail(readiness, launchEvidence),
      severity: buildLaunchSeverity(readiness, launchEvidence),
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

function buildLaunchValue(
  readiness: ReturnType<typeof summarizeReadiness>,
  launchEvidence?: LaunchGateEvidence,
): string {
  if (launchEvidence?.fresh === false) {
    return "Stale";
  }

  if (launchEvidence) {
    if (launchEvidence.localDecision === "failed") {
      return "Failed";
    }

    if (launchEvidence.productionDecision === "blocked") {
      return "Blocked";
    }

    return "Ready";
  }

  if (readiness.blockedChecks > 0) {
    return "Blocked";
  }

  if (readiness.degradedChecks > 0) {
    return "Degraded";
  }

  return "Ready";
}

function buildLaunchDetail(
  readiness: ReturnType<typeof summarizeReadiness>,
  launchEvidence?: LaunchGateEvidence,
): string {
  if (launchEvidence?.fresh === false) {
    return launchEvidence.staleReasons?.[0] ?? "Rerun launch gate for HEAD.";
  }

  if (launchEvidence) {
    const failures = launchEvidence.failureSummaries.length;
    const blockerDetail = buildExternalBlockerDetail(launchEvidence);

    if (blockerDetail) {
      return `${blockerDetail} Generated ${launchEvidence.generatedAt}`;
    }

    return `${failures} ${pluralize(
      failures,
      "failure",
    )}, 0 external blockers from ${launchEvidence.generatedAt}`;
  }

  if (readiness.blockedChecks > 0) {
    return `${readiness.blockedChecks} ${pluralize(
      readiness.blockedChecks,
      "readiness check",
    )} ${readiness.blockedChecks === 1 ? "blocks" : "block"} launch`;
  }

  if (readiness.degradedChecks > 0) {
    return `${readiness.degradedChecks} ${pluralize(
      readiness.degradedChecks,
      "readiness check",
    )} degraded before launch`;
  }

  return `${readiness.deploymentLabel} readiness has no blockers`;
}

function buildExternalBlockerDetail(
  launchEvidence: LaunchGateEvidence,
): string | undefined {
  const blockers = launchEvidence.externalBlockers.map(parseExternalBlocker);
  const [firstBlocker] = blockers;

  if (!firstBlocker) {
    return undefined;
  }

  const label = buildExternalBlockerLabel(blockers, launchEvidence);
  const remaining = blockers.length - 1;
  const remainingDetail =
    remaining > 0
      ? ` ${remaining} more external ${pluralize(remaining, "blocker")}.`
      : "";

  return `${label} blocked: ${firstBlocker.reason}${remainingDetail}`;
}

function buildExternalBlockerLabel(
  blockers: Array<{ id: string; reason: string }>,
  launchEvidence: LaunchGateEvidence,
): string {
  if (
    blockers.every((blocker) =>
      ["db_validate", "db_migrate_deploy", "smoke_api_postgres"].includes(
        blocker.id,
      ),
    )
  ) {
    return "Postgres launch verification";
  }

  const [firstBlocker] = blockers;
  const check = launchEvidence.checks.find(
    (candidate) => candidate.id === firstBlocker?.id,
  );

  return check?.label ?? humanizeLaunchGateCheckId(firstBlocker?.id ?? "");
}

function parseExternalBlocker(value: string): { id: string; reason: string } {
  const [id, ...reasonParts] = value.split(":");
  const reason = reasonParts.join(":").trim();

  return {
    id: id.trim(),
    reason: reason || "External dependency unavailable.",
  };
}

function humanizeLaunchGateCheckId(id: string): string {
  const knownLabels: Record<string, string> = {
    db_validate: "Postgres schema validation",
    db_migrate_deploy: "Postgres migration deploy",
    smoke_api_postgres: "Postgres API smoke",
  };

  if (knownLabels[id]) {
    return knownLabels[id];
  }

  return id
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function buildLaunchSeverity(
  readiness: ReturnType<typeof summarizeReadiness>,
  launchEvidence?: LaunchGateEvidence,
): DeliveryTopbarHealthSeverity {
  if (!launchEvidence) {
    return readiness.severity;
  }

  if (launchEvidence.fresh === false) {
    return "danger";
  }

  if (launchEvidence.localDecision === "failed") {
    return "danger";
  }

  if (launchEvidence.productionDecision === "blocked") {
    return "warning";
  }

  return "healthy";
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
