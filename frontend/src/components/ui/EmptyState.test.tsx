import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import { Briefcase } from "../icons";

const defaultProps = {
  title: "Your portfolio is empty.",
  description: "Once you deposit, you'll be able to track your assets here.",
  icon: <Briefcase size={40} />,
};

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState {...defaultProps} />);

    expect(screen.getByText("Your portfolio is empty.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Once you deposit, you'll be able to track your assets here.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the icon wrapper", () => {
    render(<EmptyState {...defaultProps} />);

    // The icon wrapper is aria-hidden; verify it exists via its class
    const wrapper = document.querySelector(".empty-state-icon-wrapper");
    expect(wrapper).toBeInTheDocument();
  });

  it("renders the CTA button when actionLabel and onAction are provided", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        {...defaultProps}
        actionLabel="Deposit Now"
        onAction={onAction}
      />,
    );

    const button = screen.getByRole("button", { name: "Deposit Now" });
    expect(button).toBeInTheDocument();
  });

  it("calls onAction when the CTA button is clicked", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        {...defaultProps}
        actionLabel="Deposit Now"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deposit Now" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not render a CTA button when actionLabel is omitted", () => {
    render(<EmptyState {...defaultProps} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render a CTA button when onAction is omitted", () => {
    render(<EmptyState {...defaultProps} actionLabel="Deposit Now" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies the default variant class", () => {
    const { container } = render(<EmptyState {...defaultProps} />);

    expect(container.firstChild).toHaveClass("empty-state-default");
  });

  it("applies the minimal variant class", () => {
    const { container } = render(
      <EmptyState {...defaultProps} variant="minimal" />,
    );

    expect(container.firstChild).toHaveClass("empty-state-minimal");
  });

  it("forwards extra className to the root element", () => {
    const { container } = render(
      <EmptyState {...defaultProps} className="my-custom-class" />,
    );

    expect(container.firstChild).toHaveClass("my-custom-class");
  });

  it("has role=status for screen reader accessibility", () => {
    render(<EmptyState {...defaultProps} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-label matching the title", () => {
    render(<EmptyState {...defaultProps} />);

    expect(
      screen.getByRole("status", { name: "Your portfolio is empty." }),
    ).toBeInTheDocument();
  });
});
