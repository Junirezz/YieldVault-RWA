import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import SkipLinks from "../components/SkipLinks";
import RouteAnnouncer from "../components/RouteAnnouncer";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/Modal";

describe("Screen reader accessibility", () => {
  it("announces skip links, live route changes, and labeled controls", async () => {
    const { container } = render(
      <MemoryRouter>
        <SkipLinks />
        <RouteAnnouncer />
        <nav id="primary-nav" aria-label="Primary">
          <a href="/">Home</a>
        </nav>
        <main id="main-content">
          <h1 data-page-heading="true">Vaults</h1>
          <Button aria-label="Connect wallet">Connect</Button>
          <Input label="Deposit amount" />
        </main>
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Skip links" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.getByLabelText("Deposit amount")).toBeInTheDocument();
    expect(container.querySelector("[aria-live='polite']")).toBeTruthy();

    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    expect(results.violations).toHaveLength(0);
  });

  it("exposes modal dialog semantics for screen readers", async () => {
    render(
      <Modal isOpen onClose={() => undefined} title="Confirm deposit" description="Review the amount">
        <button>Confirm</button>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Confirm deposit" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-describedby");

    const results = await axe.run(document.body, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { region: { enabled: false } },
    });
    expect(results.violations).toHaveLength(0);
  });
});
