import { FileText } from "lucide-react";

export type ArtifactDrawerKind =
  | "stdout"
  | "stderr"
  | "patch"
  | "report"
  | "audit";

export type ArtifactDrawerLink = {
  id: string;
  kind: ArtifactDrawerKind;
  label: string;
  href: string;
  meta?: string;
  path?: string;
};

export type ArtifactDrawerGroup = {
  kind: ArtifactDrawerKind;
  title: string;
  countLabel: string;
  links: ArtifactDrawerLink[];
};

export type ArtifactDrawerMetadata = {
  visibleLabel: string;
  fullLabel: string;
};

type ArtifactDrawerProps = {
  artifacts: ArtifactDrawerLink[];
  title?: string;
};

const artifactOrder: ArtifactDrawerKind[] = [
  "stdout",
  "stderr",
  "patch",
  "report",
  "audit",
];

const artifactGroupTitles: Record<ArtifactDrawerKind, string> = {
  stdout: "Run output",
  stderr: "Errors",
  patch: "Patches",
  report: "Reports",
  audit: "Audit",
};

function formatArtifactLinkCount(count: number): string {
  return `${count} ${count === 1 ? "link" : "links"}`;
}

export function buildArtifactDrawerGroups(
  artifacts: ArtifactDrawerLink[],
): ArtifactDrawerGroup[] {
  return artifactOrder.flatMap((kind) => {
    const links = artifacts.filter((artifact) => artifact.kind === kind);

    if (!links.length) {
      return [];
    }

    return [
      {
        kind,
        title: artifactGroupTitles[kind],
        countLabel: formatArtifactLinkCount(links.length),
        links,
      },
    ];
  });
}

export function buildArtifactDrawerMetadata(
  artifact: ArtifactDrawerLink,
): ArtifactDrawerMetadata | undefined {
  const sourceWorkflow = buildArtifactSourceWorkflowLabel(artifact.href);
  const visibleParts = [
    artifact.meta,
    sourceWorkflow,
    artifact.path ? compactArtifactPath(artifact.path) : undefined,
  ].filter(isPresent);
  const fullParts = [artifact.meta, sourceWorkflow, artifact.path].filter(
    isPresent,
  );

  if (!fullParts.length) {
    return undefined;
  }

  return {
    visibleLabel: visibleParts.join(" / "),
    fullLabel: fullParts.join(" / "),
  };
}

export function ArtifactDrawer({
  artifacts,
  title = "Artifacts",
}: ArtifactDrawerProps) {
  const groups = buildArtifactDrawerGroups(artifacts);
  const linkLabel = formatArtifactLinkCount(artifacts.length);
  const summaryLabels = buildArtifactDrawerSummaryLabels(groups);
  const summaryAriaLabel = [`${title}: ${linkLabel}`, ...summaryLabels].join(
    "; ",
  );

  return (
    <details className="artifactDrawer">
      <summary aria-label={summaryAriaLabel} className="artifactDrawerSummary">
        <span className="artifactDrawerSummaryTitle">
          <FileText size={16} aria-hidden="true" />
          <strong>{title}</strong>
        </span>
        {summaryLabels.length ? (
          <span className="artifactDrawerSummaryGroups" aria-hidden="true">
            {summaryLabels.map((label) => (
              <span className="artifactDrawerSummaryPill" key={label}>
                {label}
              </span>
            ))}
          </span>
        ) : null}
        <em>{linkLabel}</em>
      </summary>

      {groups.length ? (
        <div className="artifactDrawerGroups">
          {groups.map((group) => (
            <section
              aria-label={`Artifact group ${group.title}`}
              className="artifactDrawerGroup"
              key={group.kind}
            >
              <h3>
                <span>{group.title}</span>
                <em>{group.countLabel}</em>
              </h3>
              <ul className="artifactDrawerList">
                {group.links.map((artifact) => {
                  const metadata = buildArtifactDrawerMetadata(artifact);

                  return (
                    <li className="artifactDrawerItem" key={artifact.id}>
                      <a className="artifactDrawerLink" href={artifact.href}>
                        {artifact.label}
                      </a>
                      {metadata ? (
                        <span
                          className="artifactDrawerMeta"
                          title={metadata.fullLabel}
                        >
                          {metadata.visibleLabel}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="artifactDrawerEmpty">No artifacts linked yet</div>
      )}
    </details>
  );
}

function isPresent(value: string | undefined): value is string {
  return Boolean(value);
}

function buildArtifactDrawerSummaryLabels(
  groups: ArtifactDrawerGroup[],
): string[] {
  return groups.map((group) => `${group.title} ${group.links.length}`);
}

function compactArtifactPath(path: string): string {
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

function buildArtifactSourceWorkflowLabel(href: string): string | undefined {
  const match = href.match(/^\/workflows\/([^/]+)(?:\/|$)/);
  const workflowId = match?.[1];

  return workflowId
    ? `Source workflow ${decodeURIComponent(workflowId)}`
    : undefined;
}
