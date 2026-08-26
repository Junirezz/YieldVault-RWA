import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SkipLinks from "./SkipLinks";

describe("SkipLinks", () => {
  it("renders skip links to main content and navigation", () => {
    render(
      <>
        <SkipLinks />
        <nav id="primary-nav" aria-label="Primary">
          Navigation
        </nav>
        <main id="main-content">Main</main>
      </>,
    );

    const mainLink = screen.getByRole("link", { name: "Skip to main content" });
    const navLink = screen.getByRole("link", { name: "Skip to navigation" });

    expect(mainLink).toHaveAttribute("href", "#main-content");
    expect(navLink).toHaveAttribute("href", "#primary-nav");
  });

  it("is keyboard reachable", async () => {
    const user = userEvent.setup();
    render(<SkipLinks />);

    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to navigation" })).toHaveFocus();
  });
});
