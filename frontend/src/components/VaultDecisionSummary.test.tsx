import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import VaultDecisionSummary from "./VaultDecisionSummary";

describe("VaultDecisionSummary (issue #989 — decision-first hierarchy)", () => {
  it("surfaces the headline APY and TVL for fast scanning", () => {
    render(
      <VaultDecisionSummary
        usdcBalance={0}
        apy={8.45}
        formattedTvl="$12,450,800"
        walletConnected={false}
      />,
    );

    expect(screen.getByText("Vault APY")).toBeInTheDocument();
    expect(screen.getByText("8.45%")).toBeInTheDocument();
    expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
    expect(screen.getByText("$12,450,800")).toBeInTheDocument();
  });

  it("shows a personalized position and projected annual yield when connected", () => {
    render(
      <VaultDecisionSummary
        usdcBalance={1000}
        apy={8.45}
        formattedTvl="$12,450,800"
        walletConnected
      />,
    );

    expect(screen.getByText("Your Balance")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Projected Annual Yield")).toBeInTheDocument();
    // 1000 * 8.45% = 84.50
    expect(screen.getByText("$84.50")).toBeInTheDocument();
  });

  it("suppresses personal position when wallet is not connected", () => {
    render(
      <VaultDecisionSummary
        usdcBalance={1000}
        apy={8.45}
        formattedTvl="$12,450,800"
        walletConnected={false}
      />,
    );

    expect(screen.queryByText("$1,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText("$84.50")).not.toBeInTheDocument();
  });

  it("renders a primary deposit call to action when connected", () => {
    render(
      <VaultDecisionSummary
        usdcBalance={500}
        apy={8.45}
        formattedTvl="$12,450,800"
        walletConnected
        onDepositClick={() => {}}
      />,
    );

    const cta = screen.getByRole("button", { name: /Deposit USDC to start earning/i });
    expect(cta).toBeInTheDocument();
  });
});
