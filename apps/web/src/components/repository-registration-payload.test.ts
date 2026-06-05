import { describe, expect, it } from "vitest";
import {
  buildRepositoryRegistrationPayload,
  canRegisterRepository
} from "./repository-registration-payload";

describe("repository registration payload", () => {
  it("builds a repository registration request from form fields", () => {
    const payload = buildRepositoryRegistrationPayload({
      name: " MAWO Core ",
      path: " C:/repos/mawo ",
      defaultBranch: " main ",
      qualityGateCommand: " npm run test ",
      qualityGateTimeoutMs: "600000"
    });

    expect(payload).toEqual({
      name: "MAWO Core",
      path: "C:/repos/mawo",
      defaultBranch: "main",
      qualityGates: [
        {
          id: "registration-quality-gate",
          title: "Registration quality gate",
          command: "npm run test",
          timeoutMs: 600000
        }
      ]
    });
  });

  it("omits empty optional fields", () => {
    const payload = buildRepositoryRegistrationPayload({
      name: "MAWO Core",
      path: "C:/repos/mawo",
      defaultBranch: " ",
      qualityGateCommand: " ",
      qualityGateTimeoutMs: ""
    });

    expect(payload).toEqual({
      name: "MAWO Core",
      path: "C:/repos/mawo",
      qualityGates: []
    });
  });

  it("detects invalid repository registration fields", () => {
    expect(
      canRegisterRepository({
        name: "MAWO Core",
        path: "C:/repos/mawo",
        defaultBranch: "main",
        qualityGateCommand: "npm test",
        qualityGateTimeoutMs: "600000"
      })
    ).toBe(true);

    expect(
      canRegisterRepository({
        name: "MAWO Core",
        path: "",
        defaultBranch: "",
        qualityGateCommand: "",
        qualityGateTimeoutMs: ""
      })
    ).toBe(false);

    expect(
      canRegisterRepository({
        name: "MAWO Core",
        path: "C:/repos/mawo",
        defaultBranch: "",
        qualityGateCommand: "npm test",
        qualityGateTimeoutMs: "-1"
      })
    ).toBe(false);
  });
});
