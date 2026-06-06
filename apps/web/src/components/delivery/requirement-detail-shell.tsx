import {
  Check,
  ClipboardCheck,
  GitBranch,
  ListChecks,
  RefreshCw,
  X
} from "lucide-react";
import type { RequirementStage, RequirementSummary } from "./delivery-console-model";
import { ArtifactDrawer, type ArtifactDrawerLink } from "./artifact-drawer";

type RequirementDetailShellProps = {
  requirement?: RequirementSummary;
  artifacts?: ArtifactDrawerLink[];
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

export function RequirementDetailShell({
  requirement,
  artifacts = [],
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

            {section.title === "Execution" ? (
              <ArtifactDrawer artifacts={artifacts} />
            ) : null}

            {section.title === "Review" ? (
              <div className="requirementDetailActions" aria-label="Review actions">
                <button className="secondaryButton" disabled={actionDisabled} type="button">
                  <Check size={16} aria-hidden="true" />
                  Approve
                </button>
                <button className="secondaryButton dangerButton" disabled={actionDisabled} type="button">
                  <X size={16} aria-hidden="true" />
                  Reject
                </button>
                <button className="secondaryButton" disabled={actionDisabled} type="button">
                  <RefreshCw size={16} aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
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
        { label: "Task progress", value: requirement.nodeLabel },
        { label: "Log access", value: "Open artifact drawer for stdout and stderr links" },
        { label: "Actions", value: requirement.nextAction }
      ];
    case "Gates":
      return [
        { label: "Required gate status", value: buildGateSummary(requirement) },
        { label: "Blocking rule", value: buildGateBlockingRule(requirement) },
        { label: "Command evidence", value: "Linked through artifacts when reported" },
        { label: "Exit code", value: "Summarized in report artifact when available" }
      ];
    case "Review":
      return [
        { label: "Delivery summary", value: buildReviewSummary(requirement) },
        { label: "Changed files", value: "Changed file summary appears in report evidence" },
        { label: "Patch artifacts", value: buildMergeCandidateStatus(requirement) },
        { label: "Risks", value: `${requirement.riskLevel} risk` },
        { label: "Merge candidate", value: requirement.repositorySafety.mergePolicyLabel }
      ];
    case "Value Report":
      return [
        { label: "Goal status", value: buildValueStatus(requirement) },
        { label: "What changed", value: "Reported in delivery report evidence" },
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
    return "Failed required gate blocks merge-ready conclusion";
  }

  return "Required gates must pass before merge-ready conclusion";
}

function buildMergeCandidateStatus(requirement: RequirementSummary): string {
  if (
    requirement.executionStatus === "needs_review" ||
    requirement.executionStatus === "completed"
  ) {
    return "Merge candidate ready for manual apply";
  }

  if (requirement.executionStatus === "gate_failed") {
    return "Merge candidate blocked by required gate";
  }

  return "Merge candidate pending";
}

function buildReviewSummary(requirement: RequirementSummary): string {
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
