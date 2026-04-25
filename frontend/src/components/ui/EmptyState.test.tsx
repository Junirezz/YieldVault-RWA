import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmptyState from "./EmptyState";
import React from "react";

describe("EmptyState", () => {
  const defaultProps = {
    title: "No Data Found",
    description: "There is nothing to show here yet.",
    icon: <span data-testid="mock-icon">Icon</span>,
  };

  it("renders title and description", () => {
    render(<EmptyState {...defaultProps} />);
    
    expect(screen.getByText(defaultProps.title)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.description)).toBeInTheDocument();
    expect(screen.getByTestId("mock-icon")).toBeInTheDocument();
  });

  it("renders action button when actionLabel and onAction are provided", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        {...defaultProps}
        actionLabel="Click Me"
        onAction={onAction}
      />
    );

    const button = screen.getByRole("button", { name: /click me/i });
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not render button when actionLabel is missing", () => {
    const onAction = vi.fn();
    render(<EmptyState {...defaultProps} onAction={onAction} />);
    
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies the correct variant class", () => {
    const { container } = render(<EmptyState {...defaultProps} variant="minimal" />);
    
    expect(container.firstChild).toHaveClass("empty-state-minimal");
  });
});
