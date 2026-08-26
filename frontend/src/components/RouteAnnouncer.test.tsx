import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RouteAnnouncer from "./RouteAnnouncer";

describe("RouteAnnouncer", () => {
  it("exposes a polite live region for screen readers", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/portfolio"]}>
        <h1 data-page-heading="true">Portfolio</h1>
        <RouteAnnouncer />
      </MemoryRouter>,
    );

    const live = container.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveAttribute("aria-atomic", "true");
  });
});
