"use client";

import {
  Check,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  DeliveryConsoleModel,
  RequirementLifecycleAction,
  RequirementReviewAction,
  RequirementSummary,
} from "./delivery-console-model";
import {
  buildDecisionQueueDisplay,
  buildRequirementQueueRows,
  type RequirementQueueRow,
} from "./requirement-queue-display";
import { NewRequirementPanel } from "./new-requirement-panel";
import type { NewRequirementPayload } from "./new-requirement-payload";
import { RequirementDetailShell } from "./requirement-detail-shell";
import {
  RequirementEvidencePanel,
  buildRequirementEvidenceArtifactLinks,
} from "./requirement-evidence-panel";
import { buildRequirementStageStepper } from "./requirement-stage-stepper";
import type { DeliveryTopbarHealthIndicator } from "./delivery-topbar-health";

type RequirementDeliveryConsoleProps = {
  model: DeliveryConsoleModel;
  syncMessage?: string;
  syncTone?: "muted" | "danger";
  topbarHealthIndicators?: DeliveryTopbarHealthIndicator[];
  viewerMode?: boolean;
  initialNewRequirementPanelOpen?: boolean;
  onRequirementLifecycleAction?: (
    requirementId: string,
    action: RequirementLifecycleAction,
  ) => Promise<void> | void;
  onRequirementReviewAction?: (
    requirementId: string,
    workflowRunId: string,
    action: RequirementReviewAction,
  ) => Promise<void> | void;
  onNewRequirementSubmit?: (
    payload: NewRequirementPayload,
  ) => Promise<string | void> | string | void;
};

type RequirementActionState = {
  action: RequirementLifecycleAction;
  message: string;
  requirementId: string;
  status: "error" | "loading" | "success";
};

type RequirementReviewActionState = {
  action: RequirementReviewAction;
  message: string;
  requirementId: string;
  status: "error" | "loading" | "success";
};

const actionLabels: Record<RequirementLifecycleAction, string> = {
  cancel: "Cancel",
  "confirm-plan": "Confirm plan",
  enqueue: "Enqueue",
  retry: "Retry",
};

const loadingActionLabels: Record<RequirementLifecycleAction, string> = {
  cancel: "Canceling",
  "confirm-plan": "Confirming plan",
  enqueue: "Enqueueing",
  retry: "Retrying",
};

const successActionMessages: Record<
  Exclude<RequirementLifecycleAction, "cancel" | "retry">,
  string
> = {
  "confirm-plan": "Plan confirmed",
  enqueue: "Requirement enqueued",
};

const retryResetMessage =
  "Retry reset to ready. Enqueue to run fresh evidence. Stale execution evidence is superseded.";

const reviewLoadingActionLabels: Record<RequirementReviewAction, string> = {
  approve: "Approving review",
  reject: "Rejecting review",
};

const reviewSuccessActionMessages: Record<RequirementReviewAction, string> = {
  approve: "Review approved",
  reject: "Review rejected",
};

export function RequirementDeliveryConsole({
  model,
  syncMessage,
  syncTone = "muted",
  topbarHealthIndicators = [],
  viewerMode = false,
  initialNewRequirementPanelOpen = false,
  onRequirementLifecycleAction,
  onRequirementReviewAction,
  onNewRequirementSubmit,
}: RequirementDeliveryConsoleProps) {
  const [isNewRequirementPanelOpen, setIsNewRequirementPanelOpen] = useState(
    initialNewRequirementPanelOpen,
  );
  const [newRequirementMessage, setNewRequirementMessage] = useState<string>();
  const [requirementActionState, setRequirementActionState] =
    useState<RequirementActionState>();
  const [requirementReviewActionState, setRequirementReviewActionState] =
    useState<RequirementReviewActionState>();
  const [selectedRequirementId, setSelectedRequirementId] = useState<string>();
  const queueRows = buildRequirementQueueRows(model.requirements);
  const decisionRows = buildDecisionQueueDisplay(model.decisionQueue);
  const selectedRequirement =
    model.requirements.find(
      (requirement) => requirement.id === selectedRequirementId,
    ) ?? model.requirements[0];
  const stageSteps = buildRequirementStageStepper(
    selectedRequirement?.requirementStage ?? "draft",
  );
  const selectedRequirementArtifacts = selectedRequirement
    ? buildRequirementEvidenceArtifactLinks(selectedRequirement, {
        includeMergeCandidate:
          selectedRequirement.executionStatus === "needs_review" ||
          selectedRequirement.executionStatus === "completed",
      })
    : [];

  async function handleNewRequirementSubmit(payload: NewRequirementPayload) {
    setNewRequirementMessage(`Creating requirement draft for ${payload.title}`);

    try {
      const createdRequirementId = await onNewRequirementSubmit?.(payload);
      setNewRequirementMessage(`Requirement draft submitted for ${payload.title}`);
      if (createdRequirementId) {
        setSelectedRequirementId(createdRequirementId);
      }
      setIsNewRequirementPanelOpen(false);
    } catch (error: unknown) {
      setNewRequirementMessage(
        error instanceof Error
          ? error.message
          : "Requirement draft submission failed",
      );
    }
  }

  async function handleRequirementLifecycleAction(
    requirementId: string,
    action: RequirementLifecycleAction,
  ) {
    const requirementTitle =
      model.requirements.find((requirement) => requirement.id === requirementId)
        ?.title ?? requirementId;

    setRequirementActionState({
      action,
      message: `${loadingActionLabels[action]} for ${requirementTitle}`,
      requirementId,
      status: "loading",
    });

    try {
      await onRequirementLifecycleAction?.(requirementId, action);
      setRequirementActionState({
        action,
        message: buildRequirementLifecycleSuccessMessage(
          action,
          requirementTitle,
        ),
        requirementId,
        status: "success",
      });
    } catch (error: unknown) {
      setRequirementActionState({
        action,
        message:
          error instanceof Error
            ? error.message
            : `${actionLabels[action]} failed for ${requirementTitle}`,
        requirementId,
        status: "error",
      });
    }
  }

  async function handleRequirementReviewAction(
    requirement: RequirementSummary,
    action: RequirementReviewAction,
  ) {
    if (!requirement.workflowRunId) {
      setRequirementReviewActionState({
        action,
        message: "Linked workflow run is required before review",
        requirementId: requirement.id,
        status: "error",
      });
      return;
    }

    setRequirementReviewActionState({
      action,
      message: `${reviewLoadingActionLabels[action]} for ${requirement.title}`,
      requirementId: requirement.id,
      status: "loading",
    });

    try {
      await onRequirementReviewAction?.(
        requirement.id,
        requirement.workflowRunId,
        action,
      );
      setRequirementReviewActionState({
        action,
        message: `${reviewSuccessActionMessages[action]}: ${requirement.title}`,
        requirementId: requirement.id,
        status: "success",
      });
    } catch (error: unknown) {
      setRequirementReviewActionState({
        action,
        message:
          error instanceof Error
            ? error.message
            : `${reviewSuccessActionMessages[action]} failed: ${requirement.title}`,
        requirementId: requirement.id,
        status: "error",
      });
    }
  }

  return (
    <main className="deliveryShell" aria-labelledby="delivery-title">
      <section className="deliveryTopbar">
        <div>
          <p className="eyebrow">Local agent safety console</p>
          <h1 id="delivery-title">Requirement Delivery Console</h1>
        </div>
        <div className="deliveryTopbarControls">
          <DeliveryHealthIndicators indicators={topbarHealthIndicators} />
          <div className="deliveryTopbarActions" aria-label="Primary actions">
            <label className="deliverySearch">
              <Search size={16} aria-hidden="true" />
              <span>Search requirements, repos, reports</span>
            </label>
            <button
              className="primaryButton"
              type="button"
              disabled={viewerMode}
              aria-controls="new-requirement-panel"
              aria-expanded={isNewRequirementPanelOpen}
              onClick={() => setIsNewRequirementPanelOpen(true)}
            >
              <Plus size={16} aria-hidden="true" />
              New Requirement
            </button>
            <a className="secondaryButton" href="#legacy-run-console">
              <Settings size={16} aria-hidden="true" />
              Legacy Run Console
            </a>
          </div>
        </div>
      </section>

      {viewerMode ? (
        <section className="viewerModeBanner" aria-label="Viewer mode">
          <strong>Viewer mode</strong>
          <span>
            Write actions are disabled. Review evidence remains readable.
          </span>
        </section>
      ) : null}

      {newRequirementMessage ? (
        <section className="deliverySyncBanner" aria-label="New requirement">
          {newRequirementMessage}
        </section>
      ) : null}

      {requirementReviewActionState ? (
        <section
          className={
            requirementReviewActionState.status === "error"
              ? "deliverySyncBanner danger"
              : "deliverySyncBanner"
          }
          aria-label="Review decision"
          role={
            requirementReviewActionState.status === "error" ? "alert" : "status"
          }
        >
          {requirementReviewActionState.message}
        </section>
      ) : null}

      {syncMessage ? (
        <section
          className={`deliverySyncBanner ${syncTone}`}
          aria-label="Workflow sync"
        >
          {syncMessage}
        </section>
      ) : null}

      {isNewRequirementPanelOpen ? (
        <NewRequirementPanel
          viewerMode={viewerMode}
          onCancel={() => setIsNewRequirementPanelOpen(false)}
          onSubmit={handleNewRequirementSubmit}
        />
      ) : null}

      <section
        className="deliveryKpis"
        aria-label="Requirement delivery metrics"
      >
        <Metric label="Active" value={model.kpis.activeRequirements} />
        <Metric
          label="Needs Clarification"
          value={model.kpis.needsClarification}
        />
        <Metric label="Running" value={model.kpis.runningTasks} />
        <Metric
          label="Failed Gates"
          value={model.kpis.failedGates}
          tone="danger"
        />
        <Metric label="Waiting Review" value={model.kpis.waitingForReview} />
        <Metric
          label="Delivered 7d"
          value={model.kpis.deliveredLastSevenDays}
        />
      </section>

      <section
        className="deliveryGrid"
        aria-label="Requirement delivery workspace"
      >
        <aside className="deliveryPanel requirementQueuePanel">
          <div className="deliveryPanelHeader">
            <h2>Requirement Queue</h2>
            <span>{queueRows.length} active</span>
          </div>
          {queueRows.length ? (
            <div className="requirementQueueList">
              {queueRows.map((row) => (
                <article
                  className={`requirementQueueItem ${
                    row.id === selectedRequirement?.id ? "selected" : ""
                  }`}
                  key={row.id}
                >
                  <button
                    aria-pressed={row.id === selectedRequirement?.id}
                    aria-label={`Select requirement ${row.title}`}
                    className="requirementQueueSelect"
                    onClick={() => setSelectedRequirementId(row.id)}
                    type="button"
                  >
                    <strong>{row.title}</strong>
                    <span>{row.repositoryLabel}</span>
                  </button>
                  <div className="requirementQueueMeta">
                    <span>{row.stageLabel}</span>
                    <span>{row.riskLabel}</span>
                  </div>
                  <p>{row.nextAction}</p>
                  <RequirementRunStatus row={row} />
                  <RequirementQueueActions
                    actionState={requirementActionState}
                    disabled={
                      viewerMode ||
                      !onRequirementLifecycleAction ||
                      requirementActionState?.status === "loading"
                    }
                    onAction={(action) =>
                      handleRequirementLifecycleAction(row.id, action)
                    }
                    row={row}
                  />
                  <small>
                    {row.nodeLabel} / {row.updatedAt}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <div className="deliveryEmptyState">
              <strong>No requirements yet</strong>
              <span>
                Create a requirement to produce an isolated, quality-gated merge
                candidate.
              </span>
            </div>
          )}
        </aside>

        <section className="deliveryPanel deliveryFocusPanel">
          <div className="deliveryPanelHeader">
            <h2>{selectedRequirement?.title ?? "New requirement path"}</h2>
            <span>{selectedRequirement?.riskLevel ?? "medium"} risk</span>
          </div>

          <section
            className={`repositorySafetyCard ${
              selectedRequirement?.repositorySafety.statusTone ?? "muted"
            }`}
            aria-label="Repository Safety"
          >
            <div className="repositorySafetyHeader">
              <div>
                <ShieldCheck size={20} aria-hidden="true" />
                <strong>Repository Safety</strong>
              </div>
              <span className="repositorySafetyStatus">
                {selectedRequirement?.repositorySafety.statusLabel ??
                  "Preflight pending"}
              </span>
            </div>
            <dl className="repositorySafetyList">
              {[
                [
                  "Repository",
                  selectedRequirement?.repositorySafety.repositoryLabel,
                ],
                [
                  "Mode",
                  selectedRequirement?.repositorySafety.executionModeLabel,
                ],
                ["Branch", selectedRequirement?.repositorySafety.branchLabel],
                ["HEAD", selectedRequirement?.repositorySafety.headLabel],
                [
                  "Clean state",
                  selectedRequirement?.repositorySafety.cleanStateLabel,
                ],
                [
                  "Allowed root",
                  selectedRequirement?.repositorySafety.allowedRootLabel,
                ],
                [
                  "Merge policy",
                  selectedRequirement?.repositorySafety.mergePolicyLabel,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value ?? "No requirement selected"}</dd>
                </div>
              ))}
            </dl>
            {selectedRequirement?.repositorySafety.blockedReason ? (
              <div className="repositorySafetyNotice">
                <strong>Blocked reason</strong>
                <p>{selectedRequirement.repositorySafety.blockedReason}</p>
              </div>
            ) : null}
            <div className="repositorySafetyNotice">
              <strong>Recovery action</strong>
              <p>
                {selectedRequirement?.repositorySafety.recoveryAction ??
                  "Create a requirement to run repository safety checks"}
              </p>
            </div>
            <div className="repositorySafetyContract">
              <strong>Contract</strong>
              <p>
                {selectedRequirement?.repositorySafety.mergePolicyLabel ??
                  "No MAWO auto-merge; manual git apply outside MAWO"}
              </p>
            </div>
          </section>

          <section aria-label="Stage Stepper">
            <div className="deliveryPanelHeader compact">
              <h2>Stage Stepper</h2>
              <span>
                {selectedRequirement?.nextAction ?? "Complete requirement"}
              </span>
            </div>
            <ol className="stageStepper">
              {stageSteps.map((step) => (
                <li className={`stageStep ${step.state}`} key={step.id}>
                  <span>{step.label}</span>
                  {step.reason ? <small>{step.reason}</small> : null}
                </li>
              ))}
            </ol>
          </section>

          <RequirementEvidencePanel requirement={selectedRequirement} />

          <details className="requirementDetailDisclosure">
            <summary>Requirement detail</summary>
            <RequirementDetailShell
              actionState={requirementActionState}
              artifacts={selectedRequirementArtifacts}
              reviewActionState={requirementReviewActionState}
              requirement={selectedRequirement}
              showViewerBanner={false}
              onLifecycleAction={(action) =>
                selectedRequirement
                  ? handleRequirementLifecycleAction(
                      selectedRequirement.id,
                      action,
                    )
                  : undefined
              }
              onReviewAction={
                onRequirementReviewAction && selectedRequirement
                  ? (action) =>
                      handleRequirementReviewAction(selectedRequirement, action)
                  : undefined
              }
              viewerMode={viewerMode}
            />
          </details>
        </section>

        <aside className="deliveryPanel decisionQueuePanel">
          <div className="deliveryPanelHeader">
            <h2>Decision Queue</h2>
            <span>{decisionRows.length} waiting</span>
          </div>
          {decisionRows.length ? (
            <div className="decisionQueueList">
              {decisionRows.map((decision) => (
                <button
                  aria-pressed={decision.requirementId === selectedRequirement?.id}
                  className={`decisionItem ${decision.tone} ${
                    decision.requirementId === selectedRequirement?.id
                      ? "selected"
                      : ""
                  }`}
                  key={decision.id}
                  onClick={() => setSelectedRequirementId(decision.requirementId)}
                  type="button"
                >
                  <span>{decision.severityLabel}</span>
                  <strong>{decision.title}</strong>
                  <p>{decision.actionLabel}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="deliveryEmptyState">
              <strong>No decisions waiting</strong>
              <span>
                Requirements that need review, retry, clarification, or safety
                action will appear here.
              </span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function DeliveryHealthIndicators({
  indicators,
}: {
  indicators: DeliveryTopbarHealthIndicator[];
}) {
  if (!indicators.length) {
    return null;
  }

  return (
    <div className="deliveryHealthIndicators" aria-label="Delivery health">
      {indicators.map((indicator) => (
        <div
          aria-label={`${indicator.label} ${indicator.value}: ${indicator.detail}`}
          className={`deliveryHealthIndicator ${indicator.severity}`}
          key={indicator.id}
        >
          <span>{indicator.label}</span>{" "}
          <strong>{indicator.value}</strong>
        </div>
      ))}
    </div>
  );
}

function buildRequirementLifecycleSuccessMessage(
  action: RequirementLifecycleAction,
  requirementTitle: string,
): string {
  if (action === "cancel") {
    return `Requirement job canceled: ${requirementTitle}. Run again for fresh evidence.`;
  }

  if (action === "retry") {
    return `${retryResetMessage} ${requirementTitle}`;
  }

  return `${successActionMessages[action]} for ${requirementTitle}`;
}

function RequirementRunStatus({ row }: { row: RequirementQueueRow }) {
  return (
    <div className="requirementRunStatus" aria-label="Current workflow">
      <span>Current workflow</span>
      {row.workflowRunId && row.workflowRunHref ? (
        <a href={row.workflowRunHref}>
          <ExternalLink size={13} aria-hidden="true" />
          {row.workflowRunId}
        </a>
      ) : (
        <strong>No run linked</strong>
      )}
      <strong>{row.currentJobStatusLabel ?? row.workflowRunStatusLabel}</strong>
    </div>
  );
}

function RequirementQueueActions({
  actionState,
  disabled,
  onAction,
  row,
}: {
  actionState?: RequirementActionState;
  disabled: boolean;
  onAction: (action: RequirementLifecycleAction) => void;
  row: RequirementQueueRow;
}) {
  const rowActionState =
    actionState?.requirementId === row.id ? actionState : undefined;

  if (!row.availableActions.length) {
    return (
      <div className="requirementQueueActions" aria-label="Requirement actions">
        <button className="secondaryButton" disabled type="button">
          {row.actionBlockReason
            ? "Preflight blocked"
            : "No action available"}
        </button>
        {row.actionBlockReason ? (
          <p className="requirementActionMessage errorText">
            {row.actionBlockReason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="requirementQueueActions" aria-label="Requirement actions">
      {row.availableActions.map((action) => {
        const isLoading =
          rowActionState?.status === "loading" &&
          rowActionState.action === action;

        return (
          <button
            className={
              action === "cancel" || action === "retry"
                ? "secondaryButton dangerButton"
                : "secondaryButton"
            }
            disabled={disabled || isLoading}
            key={action}
            onClick={() => onAction(action)}
            type="button"
          >
            <ActionIcon action={action} spinning={isLoading} />
            {isLoading ? loadingActionLabels[action] : actionLabels[action]}
          </button>
        );
      })}
      {rowActionState ? (
        <p
          className={
            rowActionState.status === "error"
              ? "requirementActionMessage errorText"
              : "requirementActionMessage"
          }
          role={rowActionState.status === "error" ? "alert" : "status"}
        >
          {rowActionState.message}
        </p>
      ) : null}
    </div>
  );
}

function ActionIcon({
  action,
  spinning,
}: {
  action: RequirementLifecycleAction;
  spinning?: boolean;
}) {
  const className = spinning ? "spinIcon" : undefined;

  switch (action) {
    case "cancel":
      return <X className={className} size={16} aria-hidden="true" />;
    case "confirm-plan":
      return <Check className={className} size={16} aria-hidden="true" />;
    case "enqueue":
      return <Play className={className} size={16} aria-hidden="true" />;
    case "retry":
      return <RefreshCw className={className} size={16} aria-hidden="true" />;
  }
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className={`deliveryMetric ${tone ?? ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
