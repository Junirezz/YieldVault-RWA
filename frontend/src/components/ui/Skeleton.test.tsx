import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Skeleton, SkeletonCard, SkeletonTable, SkeletonChart } from "./index";

describe("Skeleton Component Library", () => {
  it("renders base skeleton with status role and aria attributes", () => {
    render(<Skeleton ariaLabel="Loading test..." />);
    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading test...")).toBeInTheDocument();
  });

  it("applies variant classes and custom dimensions", () => {
    render(<Skeleton variant="circular" width={50} height={50} />);
    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveClass("skeleton-variant-circular");
    expect(skeleton.style.width).toBe("50px");
    expect(skeleton.style.height).toBe("50px");
  });

  it("renders SkeletonCard component", () => {
    render(<SkeletonCard lines={4} />);
    const card = screen.getByTestId("skeleton-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveAttribute("aria-busy", "true");
  });

  it("renders SkeletonTable component with correct structure", () => {
    render(<SkeletonTable rows={3} columns={4} />);
    const table = screen.getByTestId("skeleton-table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveAttribute("role", "status");
  });

  it("renders SkeletonChart component", () => {
    render(<SkeletonChart height={300} bars={5} />);
    const chart = screen.getByTestId("skeleton-chart");
    expect(chart).toBeInTheDocument();
    expect(chart.style.height).toBe("300px");
  });
});
