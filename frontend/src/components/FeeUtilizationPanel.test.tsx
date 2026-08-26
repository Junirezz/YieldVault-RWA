import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import FeeUtilizationPanel from "./FeeUtilizationPanel";
import type { VaultFeeInfo } from "../lib/feeCurve";

const curve = {
  baseFeeBps: 25,
  optimalFeeBps: 100,
  maxFeeBps: 500,
  optimalUtilizationBps: 8_000,
};

function buildFees(overrides: Partial<VaultFeeInfo> = {}): VaultFeeInfo {
  return {
    staticFeeBps: 25,
    effectiveFeeBps: 71,
    utilizationBps: 5_000,
    dynamicEnabled: true,
    curve,
    ...overrides,
  };
}

describe("FeeUtilizationPanel", () => {
  it("shows the fee the curve charges at the reported utilization", () => {
    render(<FeeUtilizationPanel fees={buildFees()} />);

    // 50% utilization on the reference curve → 71 bps.
    expect(screen.getByTestId("current-fee")).toHaveTextContent("0.71%");
    expect(screen.getByTestId("current-utilization")).toHaveTextContent("50.0%");
    expect(screen.getByTestId("static-fee")).toHaveTextContent("0.25%");
    expect(screen.getByText("Dynamic")).toBeInTheDocument();
  });

  it("recomputes the fee from the curve rather than trusting a stale effectiveFeeBps", () => {
    render(<FeeUtilizationPanel fees={buildFees({ utilizationBps: 9_500, effectiveFeeBps: 71 })} />);

    // 95% utilization → 400 bps, not the stale 71 the API reported.
    expect(screen.getByTestId("current-fee")).toHaveTextContent("4.00%");
    expect(screen.getByTestId("current-utilization")).toHaveTextContent("95.0%");
  });

  it("shows the flat fee and hides the curve summary when dynamic fees are off", () => {
    render(
      <FeeUtilizationPanel
        fees={buildFees({ dynamicEnabled: false, staticFeeBps: 250, utilizationBps: 9_500 })}
      />,
    );

    expect(screen.getByTestId("current-fee")).toHaveTextContent("2.50%");
    expect(screen.getByText("Flat rate")).toBeInTheDocument();
    expect(screen.queryByTestId("static-fee")).not.toBeInTheDocument();
    expect(screen.queryByText(/Fees scale from/)).not.toBeInTheDocument();
  });

  it("renders the utilization meter with accessible bounds and a kink marker", () => {
    render(<FeeUtilizationPanel fees={buildFees({ utilizationBps: 8_000 })} />);

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "80");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-valuetext", "Strategy utilization is 80.0%");
    expect(screen.getByTestId("utilization-kink")).toBeInTheDocument();
  });

  it("clamps a strategy marked above the recorded total to 100%", () => {
    render(<FeeUtilizationPanel fees={buildFees({ utilizationBps: 12_000 })} />);

    expect(screen.getByTestId("current-utilization")).toHaveTextContent("100.0%");
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });

  it("says the data is unavailable rather than implying a zero fee", () => {
    render(<FeeUtilizationPanel />);

    expect(
      screen.getByText("Fee and utilization data is not being reported by this vault."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("current-fee")).not.toBeInTheDocument();
  });

  it("shows a loading message while the summary is in flight", () => {
    render(<FeeUtilizationPanel fees={buildFees()} isLoading />);

    expect(screen.getByText("Loading fee and utilization data…")).toBeInTheDocument();
    expect(screen.queryByTestId("current-fee")).not.toBeInTheDocument();
  });
});
