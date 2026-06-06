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

type ArtifactDrawerProps = {
  artifacts: ArtifactDrawerLink[];
  title?: string;
};

const artifactOrder: ArtifactDrawerKind[] = [
  "stdout",
  "stderr",
  "patch",
  "report",
  "audit"
];

const artifactGroupTitles: Record<ArtifactDrawerKind, string> = {
  stdout: "Run output",
  stderr: "Errors",
  patch: "Patches",
  report: "Reports",
  audit: "Audit"
};

function formatArtifactLinkCount(count: number): string {
  return `${count} ${count === 1 ? "link" : "links"}`;
}

export function buildArtifactDrawerGroups(
  artifacts: ArtifactDrawerLink[]
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
        links
      }
    ];
  });
}

export function ArtifactDrawer({
  artifacts,
  title = "Artifacts"
}: ArtifactDrawerProps) {
  const groups = buildArtifactDrawerGroups(artifacts);
  const linkLabel = formatArtifactLinkCount(artifacts.length);

  return (
    <details className="artifactDrawer">
      <summary className="artifactDrawerSummary">
        <span>
          <FileText size={16} aria-hidden="true" />
          <strong>{title}</strong>
        </span>
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
                  const metadata = [artifact.meta, artifact.path]
                    .filter(Boolean)
                    .join(" / ");

                  return (
                    <li className="artifactDrawerItem" key={artifact.id}>
                      <a className="artifactDrawerLink" href={artifact.href}>
                        {artifact.label}
                      </a>
                      {metadata ? (
                        <span className="artifactDrawerMeta">{metadata}</span>
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
