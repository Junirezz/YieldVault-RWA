import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HelpIcon } from "./HelpIcon";

// Mock useFloating to avoid DOM measurement issues in jsdom
vi.mock("../../hooks/useFloating", () => ({
  useFloating: () => ({
    triggerRef: { current: null },
    floatingRef: { current: null },
    floatingStyle: { position: "fixed", top: 0, left: 0 },
    actualPlacement: "bottom",
    isHidden: false,
  }),
}));

describe("HelpIcon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  describe("aria-label", () => {
    it("has the default aria-label of 'More information'", () => {
      render(<HelpIcon content="Help text" />);
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "More information");
    });

    it("uses the label prop as aria-label", () => {
      render(<HelpIcon content="Help text" label="Learn about APY" />);
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "Learn about APY");
    });
  });

  describe("icon", () => {
    it("renders an SVG icon with aria-hidden='true'", () => {
      render(<HelpIcon content="Help text" />);
      // The Info icon from lucide-react renders as an SVG
      const svg = document.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("variant='tooltip' (default)", () => {
    it("shows tooltip panel when trigger receives focus", async () => {
      const { container } = render(
        <HelpIcon content="Tooltip content" variant="tooltip" />
      );
      // The Tooltip wraps the button in a <span> with onFocus handler
      const triggerSpan = container.querySelector("span");
      expect(triggerSpan).toBeInTheDocument();

      fireEvent.focus(triggerSpan!);
      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      expect(screen.getByRole("tooltip")).toHaveTextContent("Tooltip content");
    });
  });

  describe("variant='popover'", () => {
    it("shows popover panel when trigger is clicked", () => {
      render(<HelpIcon content="Popover content" variant="popover" />);
      const button = screen.getByRole("button", { name: "More information" });

      fireEvent.click(button);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Popover content")).toBeInTheDocument();
    });
  });
});
