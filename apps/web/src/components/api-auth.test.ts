import { describe, expect, it } from "vitest";
import { buildApiHeaders } from "./api-auth";

describe("buildApiHeaders", () => {
  it("adds a bearer token when one is configured", () => {
    expect(buildApiHeaders(" secret-token ")).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-token"
    });
  });

  it("keeps caller headers when no token is configured", () => {
    expect(buildApiHeaders("", { Accept: "application/json" })).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json"
    });
  });
});
