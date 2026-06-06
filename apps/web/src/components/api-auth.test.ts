import { describe, expect, it } from "vitest";
import {
  buildApiHeaders,
  canUseOperatorActions,
  formatApiErrorMessage,
  normalizeApiTokenRole,
} from "./api-auth";

describe("buildApiHeaders", () => {
  it("adds a bearer token when one is configured", () => {
    expect(buildApiHeaders(" secret-token ")).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-token",
    });
  });

  it("keeps caller headers when no token is configured", () => {
    expect(buildApiHeaders("", { Accept: "application/json" })).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });

  it("normalizes stored API token roles", () => {
    expect(normalizeApiTokenRole("viewer")).toBe("viewer");
    expect(normalizeApiTokenRole("operator")).toBe("operator");
    expect(normalizeApiTokenRole("")).toBe("operator");
    expect(normalizeApiTokenRole(undefined)).toBe("operator");
  });

  it("allows only operator role to use mutating actions", () => {
    expect(canUseOperatorActions("operator")).toBe(true);
    expect(canUseOperatorActions("viewer")).toBe(false);
  });

  it("formats forbidden API errors as read-only token guidance", () => {
    expect(
      formatApiErrorMessage(403, "/workflows/demo", {
        error: "forbidden",
        message: "This endpoint requires an operator token.",
        role: "viewer",
      }),
    ).toBe("This token is read-only. Switch to an operator token to continue.");
  });

  it("formats unauthorized API errors as token guidance", () => {
    expect(formatApiErrorMessage(401, "/workflows")).toBe(
      "API token missing or invalid.",
    );
  });
});
