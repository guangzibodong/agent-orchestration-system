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
        title: kind,
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
  const linkLabel = `${artifacts.length} ${
    artifacts.length === 1 ? "link" : "links"
  }`;

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
            <section className="artifactDrawerGroup" key={group.kind}>
              <h3>{group.title}</h3>
              <ul className="artifactDrawerList">
                {group.links.map((artifact) => (
                  <li className="artifactDrawerItem" key={artifact.id}>
                    <a className="artifactDrawerLink" href={artifact.href}>
                      {artifact.label}
                    </a>
                    <span className="artifactDrawerMeta">
                      {[artifact.meta, artifact.path].filter(Boolean).join(" / ")}
                    </span>
                  </li>
                ))}
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
