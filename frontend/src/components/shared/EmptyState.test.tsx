import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EmptyState from "./EmptyState";
import { PackageSearch } from "../icons";

describe("EmptyState", () => {
  const defaultProps = {
    title: "No Activity",
    description: "You have no positions yet. Start by depositing USDC.",
    icon: <PackageSearch />,
    ctaLabel: "Deposit USDC",
    onAction: vi.fn(),
  };

  it("renders the title and description correctly", () => {
    render(<EmptyState {...defaultProps} />);
    
    expect(screen.getByText(defaultProps.title)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.description)).toBeInTheDocument();
  });

  it("renders the action button with correct label", () => {
    render(<EmptyState {...defaultProps} />);
    
    const actionButton = screen.getByRole("button", { name: defaultProps.ctaLabel });
    expect(actionButton).toBeInTheDocument();
    expect(actionButton).toHaveClass("btn-primary");
  });

  it("calls onAction when the action button is clicked", () => {
    render(<EmptyState {...defaultProps} />);
    
    const actionButton = screen.getByRole("button", { name: defaultProps.ctaLabel });
    fireEvent.click(actionButton);
    
    expect(defaultProps.onAction).toHaveBeenCalledTimes(1);
  });

  it("renders the provided icon", () => {
    const { container } = render(<EmptyState {...defaultProps} />);
    
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});
