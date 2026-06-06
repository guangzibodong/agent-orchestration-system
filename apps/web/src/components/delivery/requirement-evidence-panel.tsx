import type { RequirementSummary } from "./delivery-console-model";

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
    };
  }

  if (requirement.executionStatus === "gate_failed") {
    return {
      tone: "danger",
      title: "Required gate failed",
      statusLabel: "Merge-ready blocked",
      summary:
        "A required quality gate did not pass, so this requirement is blocked from a merge-ready decision.",
      items: [
        {
          label: "Gate result",
          value: "Required gate failed",
        },
        {
          label: "Merge conclusion",
          value: "Merge-ready blocked",
        },
        {
          label: "Next decision",
          value: requirement.nextAction,
        },
        {
          label: "Safety reason",
          value:
            requirement.repositorySafety.blockedReason ??
            "Quality gate failure requires rework before review",
        },
      ],
    };
  }

  if (requirement.executionStatus === "needs_review") {
    return {
      tone: "warning",
      title: "Review merge candidate evidence",
      statusLabel: "Manual review required",
      summary:
        "Quality gates passed and the merge candidate is ready for a human review decision.",
      items: [
        {
          label: "Gate result",
          value: "Quality gates passed",
        },
        {
          label: "Review action",
          value: requirement.nextAction,
        },
        {
          label: "Merge policy",
          value: requirement.repositorySafety.mergePolicyLabel,
        },
        {
          label: "Last evidence update",
          value: requirement.updatedAt,
        },
      ],
    };
  }

  if (requirement.executionStatus === "completed") {
    const approved = requirement.riskLevel === "low";

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
      ],
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
  };
}
