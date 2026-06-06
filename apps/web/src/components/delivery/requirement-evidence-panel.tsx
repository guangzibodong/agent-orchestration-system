import type { RequirementSummary } from "./delivery-console-model";
import { ArtifactDrawer, type ArtifactDrawerLink } from "./artifact-drawer";

type RequirementEvidenceTone = "danger" | "warning" | "success" | "muted";

type RequirementEvidenceItem = {
  label: string;
  value: string;
};

type RequirementEvidenceDisplay = {
  tone: RequirementEvidenceTone;
  title: string;
  statusLabel: string;
  summary: string;
  items: RequirementEvidenceItem[];
  artifactLinks: ArtifactDrawerLink[];
};

export function RequirementEvidencePanel({
  requirement,
}: {
  requirement?: RequirementSummary;
}) {
  const evidence = buildRequirementEvidenceDisplay(requirement);

  return (
    <section
      className={`requirementEvidenceCard ${evidence.tone}`}
      aria-label="Gate Result / Review Evidence"
    >
      <div className="deliveryPanelHeader compact">
        <h2>Gate Result / Review Evidence</h2>
        <span>{evidence.statusLabel}</span>
      </div>
      <div className="requirementEvidenceLead">
        <strong>{evidence.title}</strong>
        <p>{evidence.summary}</p>
      </div>
      <dl className="requirementEvidenceList">
        {evidence.items.map((item) => (
          <div className="requirementEvidenceItem" key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {evidence.artifactLinks.length ? (
        <div
          className="requirementEvidenceArtifacts"
          aria-label="Read-only evidence links"
        >
          <p>Read-only evidence links</p>
          <ArtifactDrawer
            artifacts={evidence.artifactLinks}
            title="Evidence links"
          />
        </div>
      ) : null}
    </section>
  );
}

export function buildRequirementEvidenceDisplay(
  requirement?: RequirementSummary,
): RequirementEvidenceDisplay {
  if (!requirement) {
    return {
      tone: "muted",
      title: "No requirement selected",
      statusLabel: "Evidence pending",
      summary:
        "Create or select a requirement to review quality gate and delivery evidence.",
      items: [
        {
          label: "Evidence scope",
          value: "Repository safety, quality gate status, and review readiness",
        },
      ],
      artifactLinks: [],
    };
  }

  if (requirement.executionStatus === "gate_failed") {
    return {
      tone: "danger",
      title: "Gate blocked by required gate",
      statusLabel: "Gate blocked",
      summary:
        "Required gate failed. Merge approval is blocked, but evidence remains inspectable for rework.",
      items: [
        {
          label: "Gate result",
          value: "Required gate failed",
        },
        {
          label: "Merge conclusion",
          value: "Merge approval blocked",
        },
        {
          label: "Next decision",
          value: requirement.nextAction,
        },
        {
          label: "Merge candidate",
          value: "Merge candidate blocked until required gates pass",
        },
        {
          label: "Safety reason",
          value:
            requirement.repositorySafety.blockedReason ??
            "Quality gate failure requires rework before review",
        },
        ...buildReviewEvidenceSummaryItems(requirement),
      ],
      artifactLinks: buildRequirementEvidenceArtifactLinks(requirement, {
        includeMergeCandidate: false,
      }),
    };
  }

  if (requirement.executionStatus === "needs_review") {
    return {
      tone: "warning",
      title: "Review-ready merge candidate",
      statusLabel: "Review ready",
      summary:
        requirement.reviewEvidence?.mergeCandidate?.summary ??
        "Quality gates passed and the merge candidate is ready for a human review decision. Manual review required.",
      items: [
        {
          label: "Gate result",
          value: "Quality gates passed",
        },
        {
          label: "Review evidence",
          value: "Review merge candidate evidence",
        },
        {
          label: "Review action",
          value: requirement.nextAction,
        },
        {
          label: "Merge candidate",
          value: "Patch available for human review",
        },
        {
          label: "Merge policy",
          value: requirement.repositorySafety.mergePolicyLabel,
        },
        {
          label: "Last evidence update",
          value: requirement.updatedAt,
        },
        ...buildReviewEvidenceSummaryItems(requirement),
      ],
      artifactLinks: buildRequirementEvidenceArtifactLinks(requirement, {
        includeMergeCandidate: true,
      }),
    };
  }

  if (requirement.executionStatus === "completed") {
    const approved =
      requirement.reviewDecision === "approved" ||
      requirement.requirementStage === "delivered";

    return {
      tone: approved ? "success" : "muted",
      title: "Delivered evidence",
      statusLabel: approved ? "Approved delivery" : "Delivery recorded",
      summary: approved
        ? "Review approved the requirement and the delivered evidence is ready for audit."
        : "The requirement completed, but approval evidence is not reported in this summary.",
      items: [
        {
          label: "Review result",
          value: approved ? "Approved delivery" : "Review evidence unavailable",
        },
        {
          label: "Gate result",
          value: "Quality gates passed",
        },
        {
          label: "Evidence action",
          value: requirement.nextAction,
        },
        {
          label: "Last evidence update",
          value: requirement.updatedAt,
        },
        ...buildReviewEvidenceSummaryItems(requirement),
      ],
      artifactLinks: buildRequirementEvidenceArtifactLinks(requirement, {
        includeMergeCandidate: true,
      }),
    };
  }

  return {
    tone: "muted",
    title: "Evidence pending",
    statusLabel: "Not review-ready",
    summary:
      "Quality gate and review evidence will appear here once the requirement reaches a decision point.",
    items: [
      {
        label: "Current stage",
        value: requirement.nextAction,
      },
      {
        label: "Repository safety",
        value: requirement.repositorySafety.recoveryAction,
      },
    ],
    artifactLinks: buildRequirementEvidenceArtifactLinks(requirement, {
      includeMergeCandidate: false,
    }),
  };
}

function buildReviewEvidenceSummaryItems(
  requirement: RequirementSummary,
): RequirementEvidenceItem[] {
  const evidence = requirement.reviewEvidence;

  if (!evidence) {
    return [];
  }

  const patchArtifactPath =
    evidence.mergeCandidate?.patchArtifactPath ?? evidence.patchArtifactPaths[0];
  const items: RequirementEvidenceItem[] = [];

  if (evidence.reportSummary) {
    items.push({
      label: "Delivery report",
      value: evidence.reportSummary,
    });
  }

  if (evidence.changedFiles.length) {
    items.push({
      label: "Changed files",
      value: formatEvidenceList(evidence.changedFiles),
    });
  }

  if (patchArtifactPath) {
    items.push({
      label: "Patch artifact",
      value: patchArtifactPath,
    });
  }

  const applyCommand =
    evidence.mergeCandidate?.applyCommand ??
    (patchArtifactPath ? `git apply "${patchArtifactPath}"` : undefined);

  if (applyCommand) {
    items.push({
      label: "Manual apply command",
      value: applyCommand,
    });
  }

  if (evidence.gateResults.length) {
    items.push({
      label: "Gate evidence",
      value: formatGateEvidence(evidence.gateResults),
    });
  }

  if (evidence.evidenceSourceWorkflowId) {
    items.push({
      label: "Evidence source",
      value: `Current workflow ${evidence.evidenceSourceWorkflowId}`,
    });
  }

  return items;
}

function formatEvidenceList(values: string[]): string {
  if (values.length <= 3) {
    return values.join(", ");
  }

  return `${values.slice(0, 3).join(", ")} and ${values.length - 3} more`;
}

function formatGateEvidence(
  gates: NonNullable<RequirementSummary["reviewEvidence"]>["gateResults"],
): string {
  return gates
    .map((gate) =>
      gate.exitCode === undefined
        ? `${gate.title} ${gate.status}`
        : `${gate.title} ${gate.status} (exit ${gate.exitCode})`,
    )
    .join(", ");
}

export function buildRequirementEvidenceArtifactLinks(
  requirement: RequirementSummary,
  options: { includeMergeCandidate: boolean },
): ArtifactDrawerLink[] {
  const workflowHref =
    requirement.workflowRunHref ??
    (requirement.workflowRunId
      ? `/workflows/${encodeURIComponent(requirement.workflowRunId)}`
      : undefined);
  const isWorkflowSource = requirement.source === "workflow";
  const links: ArtifactDrawerLink[] = [];

  if (workflowHref) {
    links.push({
      id: `${requirement.id}:current-workflow`,
      kind: "audit",
      label: "Current workflow",
      href: workflowHref,
      meta: requirement.workflowRunId
        ? `${requirement.workflowRunId} / ${requirement.workflowRunStatusLabel}`
        : requirement.workflowRunStatusLabel,
    });
  }

  if (workflowHref) {
    links.push({
      id: `${requirement.id}:report`,
      kind: "report",
      label: isWorkflowSource ? "Workflow report" : "Requirement report",
      href: isWorkflowSource
        ? `${workflowHref}/report`
        : `/requirements/${encodeURIComponent(requirement.id)}/report`,
      meta: "Review evidence",
    });
  }

  if (options.includeMergeCandidate && workflowHref) {
    links.push({
      id: `${requirement.id}:merge-candidate`,
      kind: "patch",
      label: "Merge candidate evidence",
      href: isWorkflowSource
        ? `${workflowHref}/merge-candidate`
        : `/requirements/${encodeURIComponent(
            requirement.id,
          )}/merge-candidate`,
      meta: "Patch path and git apply command for reviewer",
    });
  }

  return [...links, ...(requirement.artifactLinks ?? [])];
}
