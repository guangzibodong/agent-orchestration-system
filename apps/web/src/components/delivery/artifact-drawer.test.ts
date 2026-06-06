import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ArtifactDrawer,
  buildArtifactDrawerGroups,
  type ArtifactDrawerLink
} from "./artifact-drawer";

const artifactLinks: ArtifactDrawerLink[] = [
  {
    id: "stdout-1",
    kind: "stdout",
    label: "Task stdout",
    href: "/workflows/workflow-review/artifact?path=stdout.log",
    meta: "12 KB",
    path: "C:/mawo/artifacts/workflow-review/stdout.log"
  },
  {
    id: "stderr-1",
    kind: "stderr",
    label: "Gate stderr",
    href: "/workflows/workflow-review/artifact?path=stderr.log",
    meta: "3 KB",
    path: "C:/mawo/artifacts/workflow-review/stderr.log"
  },
  {
    id: "patch-1",
    kind: "patch",
    label: "Merge candidate patch",
    href: "/workflows/workflow-review/artifact?path=merge-candidate.patch",
    meta: "ready"
  },
  {
    id: "report-1",
    kind: "report",
    label: "Delivery report",
    href: "/requirements/workflow-review/report",
    meta: "review evidence"
  },
  {
    id: "audit-1",
    kind: "audit",
    label: "Audit trail",
    href: "/requirements/workflow-review/audit",
    meta: "5 events"
  }
];

describe("ArtifactDrawer", () => {
  it("groups artifact links in evidence order without rendering raw content", () => {
    expect(buildArtifactDrawerGroups(artifactLinks)).toEqual([
      {
        kind: "stdout",
        title: "stdout",
        links: [artifactLinks[0]]
      },
      {
        kind: "stderr",
        title: "stderr",
        links: [artifactLinks[1]]
      },
      {
        kind: "patch",
        title: "patch",
        links: [artifactLinks[2]]
      },
      {
        kind: "report",
        title: "report",
        links: [artifactLinks[3]]
      },
      {
        kind: "audit",
        title: "audit",
        links: [artifactLinks[4]]
      }
    ]);

    const html = renderToStaticMarkup(
      createElement(ArtifactDrawer, {
        artifacts: [
          ...artifactLinks,
          {
            id: "stdout-raw",
            kind: "stdout",
            label: "Raw stdout link",
            href: "/workflows/workflow-review/artifact?path=raw.log",
            rawContent: "SECRET_RAW_STDOUT_SHOULD_NOT_RENDER"
          } as ArtifactDrawerLink & { rawContent: string }
        ]
      })
    );

    expect(html).toContain("Artifacts");
    expect(html).toContain("6 links");
    expect(html).toContain("Task stdout");
    expect(html).toContain("Gate stderr");
    expect(html).toContain("Merge candidate patch");
    expect(html).toContain("Delivery report");
    expect(html).toContain("Audit trail");
    expect(html).toContain(
      "href=\"/workflows/workflow-review/artifact?path=stdout.log\""
    );
    expect(html).not.toContain("SECRET_RAW_STDOUT_SHOULD_NOT_RENDER");
  });

  it("is collapsed by default so logs do not dominate the first screen", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactDrawer, {
        artifacts: artifactLinks
      })
    );

    expect(html).toContain("<details");
    expect(html).toContain("class=\"artifactDrawer\"");
    expect(html).not.toContain("<details open");
  });

  it("shows a quiet empty state when no artifact links are available", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactDrawer, {
        artifacts: []
      })
    );

    expect(html).toContain("Artifacts");
    expect(html).toContain("No artifacts linked yet");
  });
});
