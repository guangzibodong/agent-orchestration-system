import { describe, expect, it } from "vitest";
import type { RepositoryRecord } from "@mawo/shared";
import {
  buildRepositoryDisplay,
  summarizeRepositories
} from "./repository-display";

const repositories: RepositoryRecord[] = [
  {
    id: "repo-1",
    name: "mawo-api",
    path: "C:/work/mawo-api",
    defaultBranch: "main",
    qualityGates: [
      {
        id: "test",
        title: "Tests",
        command: "npm test",
        timeoutMs: 300000
      }
    ],
    createdAt: "2026-06-05T10:13:10.266Z",
    updatedAt: "2026-06-05T10:13:10.266Z"
  },
  {
    id: "repo-2",
    name: "landing",
    path: "C:/work/landing",
    qualityGates: [],
    createdAt: "2026-06-05T10:14:10.266Z",
    updatedAt: "2026-06-05T10:14:10.266Z"
  }
];

describe("repository display", () => {
  it("maps registered repositories to compact operator rows", () => {
    expect(buildRepositoryDisplay(repositories)).toEqual([
      {
        id: "repo-1",
        name: "mawo-api",
        path: "C:/work/mawo-api",
        defaultBranch: "main",
        qualityGateLabel: "1 gate",
        updatedAt: "2026-06-05T10:13:10.266Z"
      },
      {
        id: "repo-2",
        name: "landing",
        path: "C:/work/landing",
        defaultBranch: "default",
        qualityGateLabel: "0 gates",
        updatedAt: "2026-06-05T10:14:10.266Z"
      }
    ]);
  });

  it("summarizes repository readiness for dashboard metrics", () => {
    expect(summarizeRepositories(repositories)).toEqual({
      total: 2,
      withQualityGates: 1
    });
  });
});
