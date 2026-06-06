import {
  Check,
  ClipboardCheck,
  GitBranch,
  ListChecks,
  Play,
  RefreshCw,
  X
} from "lucide-react";
import type {
  RequirementLifecycleAction,
  RequirementReviewAction,
  RequirementStage,
  RequirementSummary
} from "./delivery-console-model";
import { ArtifactDrawer, type ArtifactDrawerLink } from "./artifact-drawer";

type RequirementDetailShellProps = {
  actionState?: {
    action: RequirementLifecycleAction;
    requirementId: string;
    status: "error" | "loading" | "success";
  };
  reviewActionState?: {
    action: RequirementReviewAction;
    requirementId: string;
    status: "error" | "loading" | "success";
  };
  requirement?: RequirementSummary;
  artifacts?: ArtifactDrawerLink[];
  onLifecycleAction?: (action: RequirementLifecycleAction) => void;
  onReviewAction?: (action: RequirementReviewAction) => void;
  viewerMode?: boolean;
  showViewerBanner?: boolean;
};

type RequirementDetailSection = {
  id: string;
  title: string;
  eyebrow: string;
  rows: Array<{
    label: string;
    value: string;
  }>;
};

const sectionTitles = [
  "Overview",
  "Requirement",
  "Plan",
  "Execution",
  "Gates",
  "Review",
  "Value Report",
  "Audit"
];

const stageLabels: Record<RequirementStage, string> = {
  draft: "Draft",
  needs_clarification: "Needs Clarification",
  plan_review: "Plan Review",
  ready_to_run: "Ready To Run",
  running: "Running",
  needs_review: "Needs Review",
  delivered: "Delivered",
  needs_rework: "Needs Rework",
  archived: "Archived"
};

const lifecycleActionLabels: Record<RequirementLifecycleAction, string> = {
  "confirm-plan": "Confirm plan",
  enqueue: "Enqueue",
  retry: "Retry"
};

const lifecycleLoadingLabels: Record<RequirementLifecycleAction, string> = {
  "confirm-plan": "Confirming plan",
  enqueue: "Enqueueing",
  retry: "Retrying"
};

export function RequirementDetailShell({
  actionState,
  reviewActionState,
  requirement,
  artifacts = [],
  onLifecycleAction,
  onReviewAction,
  viewerMode = false,
  showViewerBanner = true,
}: RequirementDetailShellProps) {
  const sections = buildRequirementDetailSections(requirement);
  const title = requirement?.title ?? "Requirement Detail";
  const actionDisabled = viewerMode || !requirement;

  return (
    <section
      className="requirementDetailShell"
      aria-labelledby="requirement-detail-title"
    >
      <header className="requirementDetailHeader">
        <div>
          <p className="eyebrow">Requirement detail</p>
          <h1 id="requirement-detail-title">{title}</h1>
        </div>
        <div className="requirementDetailSummary" aria-label="Requirement status">
          <span>{requirement ? stageLabels[requirement.requirementStage] : "No requirement selected"}</span>
          <strong>{requirement ? `${requirement.riskLevel} risk` : "Evidence pending"}</strong>
        </div>
      </header>

      {viewerMode && showViewerBanner ? (
        <section className="viewerModeBanner" aria-label="Viewer mode">
          <strong>Viewer mode</strong>
          <span>Write actions are disabled. Review evidence remains readable.</span>
        </section>
      ) : null}

      <nav className="requirementDetailTabs" aria-label="Requirement detail sections">
        {sections.map((section) => (
          <a href={`#${section.id}`} key={section.id}>
            {section.title}
          </a>
        ))}
      </nav>

      <div className="requirementDetailGrid">
        {sections.map((section) => (
          <section
            aria-labelledby={`${section.id}-title`}
            className="requirementDetailSection"
            id={section.id}
            key={section.id}
          >
            <div className="requirementDetailSectionHeader">
              <div>
                <p className="eyebrow">{section.eyebrow}</p>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
              </div>
              {section.title === "Overview" ? (
                <ClipboardCheck size={18} aria-hidden="true" />
              ) : null}
              {section.title === "Plan" ? (
                <ListChecks size={18} aria-hidden="true" />
              ) : null}
              {section.title === "Audit" ? (
                <GitBranch size={18} aria-hidden="true" />
              ) : null}
            </div>
            <dl className="requirementDetailMetaGrid">
              {section.rows.map((row) => (
                <div className="requirementDetailMetaItem" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>

            {section.title === "Review" ? (
              <RequirementChangedFilesStrip requirement={requirement} />
            ) : null}

            {section.title === "Execution" ? (
              <>
                <ArtifactDrawer artifacts={artifacts} />
                <RequirementWorkspaceCleanup requirement={requirement} />
                <RequirementDetailLifecycleActions
                  actionState={actionState}
                  disabled={actionDisabled || !onLifecycleAction}
                  onAction={onLifecycleAction}
                  requirement={requirement}
                />
              </>
            ) : null}

            {section.title === "Review" ? (
              <RequirementReviewAcceptance
                artifacts={artifacts}
                disabled={actionDisabled}
                onLifecycleAction={onLifecycleAction}
                onReviewAction={onReviewAction}
                requirement={requirement}
                reviewActionState={reviewActionState}
                viewerMode={viewerMode}
              />
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}

function RequirementChangedFilesStrip({
  requirement,
}: {
  requirement?: RequirementSummary;
}) {
  const changedFiles = requirement?.reviewEvidence?.changedFiles ?? [];

  if (!changedFiles.length) {
    return null;
  }

  return (
    <section
      className="requirementChangedFilesStrip"
      aria-label="Changed files under review"
    >
      <div>
        <p className="eyebrow">Changed files under review</p>
        <strong>{formatChangedFileCount(changedFiles.length)}</strong>
      </div>
      <ul>
        {changedFiles.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </section>
  );
}

function RequirementWorkspaceCleanup({
  requirement,
}: {
  requirement?: RequirementSummary;
}) {
  const cleanup = requirement?.workspaceCleanup;

  if (!cleanup) {
    return null;
  }

  return (
    <section
      className="requirementWorkspaceCleanup"
      aria-label="Worktree cleanup"
    >
      <div>
        <p className="eyebrow">Workspace cleanup</p>
        <h3>Worktree cleanup</h3>
      </div>
      <dl className="requirementDetailMetaGrid">
        <div className="requirementDetailMetaItem">
          <dt>Status</dt>
          <dd>{cleanup.statusLabel}</dd>
        </div>
        <div className="requirementDetailMetaItem">
          <dt>Tracked worktrees</dt>
          <dd>{cleanup.summary}</dd>
        </div>
        <div className="requirementDetailMetaItem">
          <dt>Cleanup policy</dt>
          <dd>{cleanup.policy}</dd>
        </div>
      </dl>
      <ul className="requirementWorkspaceCleanupList">
        {cleanup.rows.map((row) => (
          <li key={`${row.branch}:${row.path}`}>
            <strong>{row.task}</strong>
            <span>{row.status}</span>
            <small>{row.branch}</small>
            <small>{row.path}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequirementReviewAcceptance({
  artifacts,
  disabled,
  onLifecycleAction,
  onReviewAction,
  requirement,
  reviewActionState,
  viewerMode,
}: {
  artifacts: ArtifactDrawerLink[];
  disabled: boolean;
  onLifecycleAction?: (action: RequirementLifecycleAction) => void;
  onReviewAction?: (action: RequirementReviewAction) => void;
  requirement?: RequirementSummary;
  reviewActionState?: RequirementDetailShellProps["reviewActionState"];
  viewerMode: boolean;
}) {
  const reviewReady =
    requirement?.executionStatus === "needs_review" &&
    Boolean(requirement.workflowRunId);
  const reviewLoading =
    reviewActionState?.status === "loading" &&
    reviewActionState.requirementId === requirement?.id;
  const reviewDisabled = disabled || !onReviewAction || !reviewReady || reviewLoading;
  const patchPath = artifacts.find(
    (artifact) => artifact.kind === "patch" && artifact.path,
  )?.path;
  const applyCommand = requirement?.reviewEvidence?.mergeCandidate?.applyCommand
    ?? (patchPath
    ? `git apply "${patchPath}"`
    : "git apply <merge-candidate.patch>");

  return (
    <div className="requirementReviewAcceptance">
      <section
        className="requirementReviewDecision"
        aria-label="Review acceptance"
      >
        <div>
          <p className="eyebrow">Human acceptance decision</p>
          <h3>Review acceptance</h3>
        </div>
        <dl className="requirementReviewDecisionGrid">
          <div>
            <dt>Decision state</dt>
            <dd>{buildReviewDecisionState(requirement, viewerMode)}</dd>
          </div>
          <div>
            <dt>Gate conclusion</dt>
            <dd>{requirement ? buildGateSummary(requirement) : "Gate evidence pending"}</dd>
          </div>
          <div>
            <dt>Workflow run</dt>
            <dd>{requirement?.workflowRunId ?? "No workflow run linked"}</dd>
          </div>
          <div>
            <dt>Manual apply command</dt>
            <dd>{applyCommand}</dd>
          </div>
        </dl>
      </section>

      <div className="requirementDetailActions" aria-label="Review actions">
        <button
          className="secondaryButton"
          disabled={reviewDisabled}
          onClick={() => onReviewAction?.("approve")}
          type="button"
        >
          <Check size={16} aria-hidden="true" />
          {reviewLoading && reviewActionState?.action === "approve"
            ? "Approving"
            : "Approve"}
        </button>
        <button
          className="secondaryButton dangerButton"
          disabled={reviewDisabled}
          onClick={() => onReviewAction?.("reject")}
          type="button"
        >
          <X size={16} aria-hidden="true" />
          {reviewLoading && reviewActionState?.action === "reject"
            ? "Rejecting"
            : "Reject"}
        </button>
        <button
          className="secondaryButton"
          disabled={
            disabled ||
            !onLifecycleAction ||
            !requirement?.availableActions.includes("retry")
          }
          onClick={() => onLifecycleAction?.("retry")}
          type="button"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Retry
        </button>
      </div>
    </div>
  );
}

function RequirementDetailLifecycleActions({
  actionState,
  disabled,
  onAction,
  requirement,
}: {
  actionState?: RequirementDetailShellProps["actionState"];
  disabled: boolean;
  onAction?: (action: RequirementLifecycleAction) => void;
  requirement?: RequirementSummary;
}) {
  const availableActions = requirement?.availableActions ?? [];

  return (
    <div className="requirementDetailActions" aria-label="Requirement lifecycle actions">
      {requirement?.actionBlockReason ? (
        <p className="requirementDetailActionBlock errorText">
          <strong>Repository safety blocked</strong>
          <span>{requirement.actionBlockReason}</span>
        </p>
      ) : null}
      {(["confirm-plan", "enqueue", "retry"] as RequirementLifecycleAction[]).map(
        (action) => {
          const isLoading =
            actionState?.status === "loading" &&
            actionState.requirementId === requirement?.id &&
            actionState.action === action;

          return (
            <button
              className={
                action === "retry" ? "secondaryButton dangerButton" : "secondaryButton"
              }
              disabled={disabled || !availableActions.includes(action) || isLoading}
              key={action}
              onClick={() => onAction?.(action)}
              type="button"
            >
              <RequirementDetailActionIcon action={action} spinning={isLoading} />
              {isLoading
                ? lifecycleLoadingLabels[action]
                : lifecycleActionLabels[action]}
            </button>
          );
        },
      )}
    </div>
  );
}

function RequirementDetailActionIcon({
  action,
  spinning,
}: {
  action: RequirementLifecycleAction;
  spinning?: boolean;
}) {
  const className = spinning ? "spinIcon" : undefined;

  switch (action) {
    case "confirm-plan":
      return <Check className={className} size={16} aria-hidden="true" />;
    case "enqueue":
      return <Play className={className} size={16} aria-hidden="true" />;
    case "retry":
      return <RefreshCw className={className} size={16} aria-hidden="true" />;
  }
}

export function buildRequirementDetailSections(
  requirement?: RequirementSummary
): RequirementDetailSection[] {
  return sectionTitles.map((title) => {
    const id = `requirement-detail-${title.toLowerCase().replace(/\s+/g, "-")}`;

    return {
      id,
      title,
      eyebrow: buildSectionEyebrow(title),
      rows: buildSectionRows(title, requirement)
    };
  });
}

function buildSectionRows(
  title: string,
  requirement?: RequirementSummary
): RequirementDetailSection["rows"] {
  if (!requirement) {
    return [
      {
        label: "Selected requirement",
        value: "No requirement selected"
      },
      {
        label: "Evidence",
        value: "Select a requirement to inspect review evidence"
      }
    ];
  }

  switch (title) {
    case "Overview":
      return [
        { label: "Current stage", value: stageLabels[requirement.requirementStage] },
        { label: "Execution mode", value: requirement.repositorySafety.executionModeLabel },
        { label: "Repository safety contract", value: requirement.repositorySafety.mergePolicyLabel },
        { label: "Next action", value: requirement.nextAction },
        { label: "Risk", value: `${requirement.riskLevel} risk` },
        { label: "Last execution result", value: buildLastExecutionResult(requirement) },
        { label: "Gate summary", value: buildGateSummary(requirement) },
        { label: "Merge candidate", value: buildMergeCandidateStatus(requirement) }
      ];
    case "Requirement":
      return [
        { label: "Title", value: requirement.title },
        { label: "Repository", value: requirement.repositoryLabel },
        { label: "Business goal", value: requirement.title },
        { label: "Context paths", value: "Context paths pending requirement contract" },
        { label: "Constraints", value: "Frozen P0 scope, local repository safety first" },
        { label: "Non-goals", value: "No auto merge, no automatic PR creation" },
        { label: "Acceptance criteria", value: "Quality-gated merge candidate evidence" },
        { label: "Quality gates", value: requirement.nodeLabel },
        { label: "Risk notes", value: `${requirement.riskLevel} risk` }
      ];
    case "Plan":
      return [
        { label: "Task plan", value: requirement.nodeLabel },
        { label: "Task objective", value: requirement.title },
        { label: "Dependency", value: "Runs inside isolated worktree evidence flow" },
        { label: "Agent or command", value: "Execution adapter selected by requirement run" },
        { label: "Gate mapping", value: buildGateSummary(requirement) },
        { label: "Task acceptance", value: "Reviewable patch plus passed required gates" },
        { label: "Owner", value: "Operator review required" }
      ];
    case "Execution":
      return [
        { label: "Current job", value: buildLastExecutionResult(requirement) },
        { label: "State", value: stageLabels[requirement.requirementStage] },
        {
          label: "Repository clean state",
          value: requirement.repositorySafety.cleanStateLabel
        },
        { label: "Task progress", value: requirement.nodeLabel },
        { label: "Log access", value: "Open artifact drawer for stdout and stderr links" },
        { label: "Actions", value: requirement.nextAction }
      ];
    case "Gates":
      return [
        { label: "Required gate status", value: buildGateSummary(requirement) },
        { label: "Blocking rule", value: buildGateBlockingRule(requirement) },
        { label: "Command evidence", value: buildGateEvidenceDetail(requirement) },
        { label: "Exit code", value: buildGateExitDetail(requirement) }
      ];
    case "Review":
      return [
        { label: "Delivery summary", value: buildReviewSummary(requirement) },
        { label: "Changed files", value: buildReviewChangedFiles(requirement) },
        { label: "Patch artifacts", value: buildReviewPatchArtifacts(requirement) },
        { label: "Risks", value: `${requirement.riskLevel} risk` },
        { label: "Merge candidate", value: requirement.repositorySafety.mergePolicyLabel }
      ];
    case "Value Report":
      return [
        { label: "Goal status", value: buildValueStatus(requirement) },
        { label: "What changed", value: buildReviewChangedFiles(requirement) },
        { label: "Time spent", value: "Pending run evidence" },
        { label: "Gates run", value: buildGateSummary(requirement) },
        { label: "Residual risks", value: `${requirement.riskLevel} risk` },
        { label: "Workflow reduction", value: "Manual review replaces raw log scanning" }
      ];
    case "Audit":
      return [
        { label: "Requirement id", value: requirement.id },
        { label: "Last updated", value: requirement.updatedAt },
        { label: "Repository path", value: requirement.repositorySafety.repositoryLabel },
        { label: "Branch", value: requirement.repositorySafety.branchLabel },
        { label: "HEAD", value: requirement.repositorySafety.headLabel },
        { label: "Audit policy", value: "Artifacts and review decisions remain inspectable" }
      ];
    default:
      return [];
  }
}

function buildSectionEyebrow(title: string): string {
  switch (title) {
    case "Overview":
      return "Status, safety, next action";
    case "Requirement":
      return "Ticket contract";
    case "Plan":
      return "Tasks and gates";
    case "Execution":
      return "Run evidence";
    case "Gates":
      return "Quality gate result";
    case "Review":
      return "Human acceptance";
    case "Value Report":
      return "Outcome summary";
    case "Audit":
      return "Traceability";
    default:
      return "Detail";
  }
}

function buildLastExecutionResult(requirement: RequirementSummary): string {
  return stageLabels[requirement.requirementStage];
}

function buildGateSummary(requirement: RequirementSummary): string {
  if (requirement.executionStatus === "gate_failed") {
    return "Required gate failed";
  }

  if (
    requirement.executionStatus === "needs_review" ||
    requirement.executionStatus === "completed"
  ) {
    return "Quality gates passed";
  }

  if (requirement.executionStatus === "running") {
    return "Gate execution pending";
  }

  return "Gate evidence pending";
}

function buildGateBlockingRule(requirement: RequirementSummary): string {
  if (requirement.executionStatus === "gate_failed") {
    return "Failed required gate blocks merge approval";
  }

  return "Required gates must pass before merge approval";
}

function buildGateEvidenceDetail(requirement: RequirementSummary): string {
  const gateResults = requirement.reviewEvidence?.gateResults ?? [];

  if (!gateResults.length) {
    return "Linked through artifacts when reported";
  }

  return gateResults.map(formatGateEvidenceDetail).join(", ");
}

function buildGateExitDetail(requirement: RequirementSummary): string {
  const gatesWithExit = (requirement.reviewEvidence?.gateResults ?? []).filter(
    (gate) => gate.exitCode !== undefined
  );

  if (!gatesWithExit.length) {
    return "Summarized in report artifact when available";
  }

  return gatesWithExit
    .map((gate) => `${gate.title} exit ${gate.exitCode}`)
    .join(", ");
}

function formatGateEvidenceDetail(
  gate: NonNullable<RequirementSummary["reviewEvidence"]>["gateResults"][number]
): string {
  const requirementLabel = gate.required ? "required" : "optional";
  const exitLabel =
    gate.exitCode === undefined ? "" : ` (exit ${gate.exitCode})`;
  const commandLabel = gate.command ? `: ${gate.command}` : "";

  return `${gate.title} ${requirementLabel} ${gate.status}${exitLabel}${commandLabel}`;
}

function buildMergeCandidateStatus(requirement: RequirementSummary): string {
  if (
    requirement.executionStatus === "needs_review" ||
    requirement.executionStatus === "completed"
  ) {
    return "Patch available for human review";
  }

  if (requirement.executionStatus === "gate_failed") {
    return "Merge candidate blocked by required gate";
  }

  return "Merge candidate pending";
}

function buildReviewSummary(requirement: RequirementSummary): string {
  if (requirement.reviewEvidence?.mergeCandidate?.summary) {
    return requirement.reviewEvidence.mergeCandidate.summary;
  }

  if (requirement.reviewEvidence?.reportSummary) {
    return requirement.reviewEvidence.reportSummary;
  }

  if (requirement.executionStatus === "needs_review") {
    return "Review evidence is ready for a human decision";
  }

  if (requirement.executionStatus === "completed") {
    return "Delivery evidence has been recorded";
  }

  if (requirement.executionStatus === "gate_failed") {
    return "Review is blocked until required gates pass";
  }

  return "Review evidence is pending";
}

function buildReviewChangedFiles(requirement: RequirementSummary): string {
  const changedFiles = requirement.reviewEvidence?.changedFiles ?? [];

  if (!changedFiles.length) {
    return "Changed file summary appears in report evidence";
  }

  return formatDetailList(changedFiles);
}

function buildReviewPatchArtifacts(requirement: RequirementSummary): string {
  const patchPath =
    requirement.reviewEvidence?.mergeCandidate?.patchArtifactPath ??
    requirement.reviewEvidence?.patchArtifactPaths[0];

  return patchPath ?? buildMergeCandidateStatus(requirement);
}

function buildReviewDecisionState(
  requirement: RequirementSummary | undefined,
  viewerMode: boolean,
): string {
  if (!requirement) {
    return "Select a requirement before review";
  }

  if (viewerMode) {
    return "Viewer read-only; operator token required";
  }

  if (
    requirement.executionStatus === "needs_review" &&
    requirement.workflowRunId
  ) {
    return "Ready for approve or reject";
  }

  if (requirement.executionStatus === "gate_failed") {
    return "Blocked until failed required gates pass";
  }

  if (requirement.executionStatus === "completed") {
    return requirement.reviewDecision === "approved"
      ? "Approved delivery recorded"
      : "Review already recorded";
  }

  return "Review decisions unlock after quality gates pass";
}

function buildValueStatus(requirement: RequirementSummary): string {
  if (requirement.executionStatus === "completed") {
    return "Goal achieved after review";
  }

  if (requirement.executionStatus === "needs_review") {
    return "Value report pending review";
  }

  if (requirement.executionStatus === "gate_failed") {
    return "Goal not achieved; rework required";
  }

  return "Goal outcome pending";
}

function formatDetailList(values: string[]): string {
  if (values.length <= 3) {
    return values.join(", ");
  }

  return `${values.slice(0, 3).join(", ")} and ${values.length - 3} more`;
}

function formatChangedFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"} changed`;
}
