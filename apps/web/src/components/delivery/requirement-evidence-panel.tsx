import type { RequirementSummary } from "./delivery-console-model";
import { ArtifactDrawer, type ArtifactDrawerLink } from "./artifact-drawer";

type RequirementEvidenceTone = "danger" | "warning" | "success" | "muted";

type RequirementEvidenceItem = {
  label: string;
  value: string;
};

export type RequirementEvidenceItemPresentation = {
  visibleValue: string;
  fullValue?: string;
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
        {evidence.items.map((item) => {
          const presentation = buildRequirementEvidenceItemPresentation(item);

          return (
            <div className="requirementEvidenceItem" key={item.label}>
              <dt>{item.label}</dt>
              <dd
                aria-label={presentation.fullValue}
                title={presentation.fullValue}
              >
                {presentation.visibleValue}
              </dd>
            </div>
          );
        })}
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
      summary: "No selected requirement evidence.",
      items: [
        {
          label: "Evidence scope",
          value: "Repository safety, quality gate status, and review readiness",
        },
      ],
      artifactLinks: [],
    };
  }

  if (
    requirement.requirementStage === "archived" ||
    requirement.executionStatus === "archived"
  ) {
    return {
      tone: "muted",
      title: "Archived evidence",
      statusLabel: "Archived",
      summary:
        "Requirement is archived and no longer active; available evidence remains read-only.",
      items: [
        {
          label: "Archive status",
          value: "No longer active",
        },
        {
          label: "Evidence action",
          value: requirement.nextAction,
        },
        {
          label: "Last evidence update",
          value: requirement.updatedAt,
        },
        ...buildReviewEvidenceSummaryItems(requirement, {
          includeManualApplyCommand: false,
        }),
      ],
      artifactLinks: buildRequirementEvidenceArtifactLinks(requirement, {
        includeMergeCandidate: false,
      }),
    };
  }

  const supersededEvidence = buildSupersededEvidenceLabel(requirement);
  if (supersededEvidence) {
    return {
      tone: "warning",
      title: "Superseded review evidence",
      statusLabel: "Superseded",
      summary: supersededEvidence,
      items: [
        {
          label: "Evidence source",
          value: supersededEvidence,
        },
        {
          label: "Current workflow",
          value: requirement.workflowRunId ?? "No current workflow linked",
        },
        {
          label: "Merge candidate",
          value:
            "Superseded merge candidate hidden until current workflow reports fresh evidence",
        },
        {
          label: "Next decision",
          value: requirement.nextAction,
        },
      ],
      artifactLinks: buildRequirementEvidenceArtifactLinks(requirement, {
        includeMergeCandidate: false,
      }),
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
        ...buildReviewEvidenceSummaryItems(requirement, {
          includeManualApplyCommand: false,
        }),
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
      "No review decision evidence is available for the current stage.",
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

export function buildRequirementEvidenceItemPresentation(
  item: RequirementEvidenceItem,
): RequirementEvidenceItemPresentation {
  if (item.label === "Patch artifact") {
    return {
      visibleValue: compactEvidencePath(item.value),
      fullValue: item.value,
    };
  }

  if (item.label === "Manual apply command") {
    const visibleCommand = compactApplyCommand(item.value);

    return {
      visibleValue: visibleCommand,
      fullValue: item.value,
    };
  }

  return {
    visibleValue: item.value,
  };
}

function buildReviewEvidenceSummaryItems(
  requirement: RequirementSummary,
  options: { includeManualApplyCommand?: boolean } = {},
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

  if (options.includeManualApplyCommand !== false && applyCommand) {
    items.push({
      label: "Manual apply command",
      value: applyCommand,
    });
  }

  items.push(...buildGateEvidenceItems(evidence.gateResults));

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

function compactApplyCommand(command: string): string {
  return command.replace(
    /"([^"]*(?:[/\\]artifacts[/\\][^"]+))"/g,
    (_match, path: string) => `"${compactEvidencePath(path)}"`,
  );
}

function compactEvidencePath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const artifactRootIndex = segments.indexOf("artifacts");

  if (artifactRootIndex >= 0 && artifactRootIndex < segments.length - 1) {
    return `.../${segments.slice(artifactRootIndex + 1).join("/")}`;
  }

  if (segments.length > 4) {
    return `.../${segments.slice(-4).join("/")}`;
  }

  return path;
}

function buildGateEvidenceItems(
  gates: NonNullable<RequirementSummary["reviewEvidence"]>["gateResults"],
): RequirementEvidenceItem[] {
  if (!gates.length) {
    return [];
  }

  const requiredGates = gates.filter((gate) => gate.required);
  const optionalGates = gates.filter((gate) => !gate.required);
  const items: RequirementEvidenceItem[] = [];

  if (requiredGates.length) {
    const failedCount = countFailedGates(requiredGates);
    const summary = failedCount
      ? `${failedCount} required reported issues`
      : `${requiredGates.length} required passed`;
    const suffix = failedCount ? "; blocks merge approval" : "";

    items.push({
      label: "Required gates",
      value: `${summary}: ${requiredGates.map(formatGateEvidenceDetail).join(", ")}${suffix}`,
    });
  }

  if (optionalGates.length) {
    const failedCount = countFailedGates(optionalGates);
    const summary = failedCount
      ? `${failedCount} optional reported issues`
      : `${optionalGates.length} optional passed`;
    const suffix = failedCount ? "; does not block merge approval" : "";

    items.push({
      label: "Optional gates",
      value: `${summary}: ${optionalGates.map(formatGateEvidenceDetail).join(", ")}${suffix}`,
    });
  }

  return items;
}

function countFailedGates(
  gates: NonNullable<RequirementSummary["reviewEvidence"]>["gateResults"],
): number {
  return gates.filter((gate) => gate.status !== "passed").length;
}

function formatGateEvidenceDetail(
  gate: NonNullable<RequirementSummary["reviewEvidence"]>["gateResults"][number],
): string {
  const exitLabel =
    gate.exitCode === undefined ? "" : ` (exit ${gate.exitCode})`;
  const commandLabel = gate.command ? `: ${gate.command}` : "";

  return `${gate.title} ${gate.status}${exitLabel}${commandLabel}`;
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

  return [...links, ...buildSupplementalArtifactLinks(requirement)];
}

function buildSupplementalArtifactLinks(
  requirement: RequirementSummary,
): ArtifactDrawerLink[] {
  const artifacts = requirement.artifactLinks ?? [];

  if (!buildSupersededEvidenceLabel(requirement)) {
    return artifacts;
  }

  const currentWorkflowId = requirement.workflowRunId;

  if (!currentWorkflowId) {
    return [];
  }

  return artifacts.filter((artifact) => {
    if (artifact.kind === "patch") {
      return false;
    }

    return extractArtifactWorkflowId(artifact) === currentWorkflowId;
  });
}

function extractArtifactWorkflowId(
  artifact: ArtifactDrawerLink,
): string | undefined {
  const hrefMatch = artifact.href.match(/^\/workflows\/([^/?#]+)(?:[/?#]|$)/);

  if (hrefMatch?.[1]) {
    return safeDecodeURIComponent(hrefMatch[1]);
  }

  const normalizedPath = artifact.path?.replace(/\\/g, "/");
  const pathMatch = normalizedPath?.match(/(?:^|\/)artifacts\/([^/]+)\//);

  return pathMatch?.[1];
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildSupersededEvidenceLabel(
  requirement: RequirementSummary,
): string | undefined {
  const canReviewCurrentEvidence =
    requirement.executionStatus === "needs_review" ||
    requirement.executionStatus === "completed";
  const evidenceSourceWorkflowId =
    requirement.reviewEvidence?.evidenceSourceWorkflowId;
  const currentWorkflowId = requirement.workflowRunId;

  if (
    canReviewCurrentEvidence &&
    evidenceSourceWorkflowId &&
    currentWorkflowId &&
    evidenceSourceWorkflowId !== currentWorkflowId
  ) {
    return `Superseded evidence from ${evidenceSourceWorkflowId}; current workflow ${currentWorkflowId} needs fresh review evidence`;
  }

  return undefined;
}
