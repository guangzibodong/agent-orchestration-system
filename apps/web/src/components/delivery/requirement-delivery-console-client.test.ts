import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequirementDeliveryConsoleClient } from "./requirement-delivery-console-client";

describe("RequirementDeliveryConsoleClient", () => {
  it("renders a requirement-first loading shell before browser data arrives", () => {
    const html = renderToStaticMarkup(
      createElement(RequirementDeliveryConsoleClient)
    );

    expect(html).toContain("Requirement Delivery Console");
    expect(html).toContain("Loading requirement tickets");
    expect(html).toContain("Requirement Queue");
    expect(html).toContain("Decision Queue");
    expect(html).not.toContain("Shell Run");
  });
});
