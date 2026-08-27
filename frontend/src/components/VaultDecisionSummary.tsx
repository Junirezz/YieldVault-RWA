import React from "react";
import { TrendingUp, Wallet as WalletIcon, Percent } from "./icons";
import { formatCurrency } from "../lib/formatters";

export interface VaultDecisionSummaryProps {
  /** Wallet USDC balance available to deposit. */
  usdcBalance: number;
  /** Current annual percentage yield (e.g. 8.45). */
  apy: number;
  /** Pre-formatted Total Value Locked string (e.g. "$12,450,800"). */
  formattedTvl: string;
  /** Whether the wallet is connected. When false, position cards are suppressed. */
  walletConnected: boolean;
  /** Called when the user clicks the primary "Deposit" call to action. */
  onDepositClick?: () => void;
}

/**
 * Decision-first summary for the vault dashboard.
 *
 * Issue #989 ("Redesign vault dashboard hierarchy for faster decision-making")
 * introduces a single scannable strip at the top of the dashboard that answers
 * the two questions a user asks first:
 *   1. What is this vault earning?  (APY + TVL)
 *   2. What is *my* position and upside? (balance + projected annual yield)
 *
 * Everything else (strategy detail, the deposit/withdraw wizard) follows below,
 * so the most decision-critical information is never buried.
 */
const VaultDecisionSummary: React.FC<VaultDecisionSummaryProps> = ({
  usdcBalance,
  apy,
  formattedTvl,
  walletConnected,
  onDepositClick,
}) => {
  const projectedAnnualYield =
    walletConnected && usdcBalance > 0 ? (usdcBalance * apy) / 100 : 0;

  return (
    <section
      className="glass-panel vault-decision-summary"
      style={{
        padding: "20px 24px",
        marginBottom: "24px",
        background: "var(--bg-muted)",
      }}
      aria-label="Vault decision summary"
    >
      <div
        className="flex gap-xl"
        style={{
          flexWrap: "wrap",
          alignItems: "stretch",
          gap: "16px",
        }}
      >
        {/* Headline metric: APY */}
        <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              marginBottom: "6px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <TrendingUp size={14} color="var(--accent-purple)" />
            Vault APY
          </div>
          <div
            className="text-gradient"
            style={{
              fontSize: "2.2rem",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            {apy > 0 ? `${apy.toFixed(2)}%` : "—"}
          </div>
        </div>

        {/* Headline metric: TVL */}
        <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              marginBottom: "6px",
            }}
          >
            Total Value Locked
          </div>
          <div
            style={{
              fontSize: "1.6rem",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {formattedTvl}
          </div>
        </div>

        {/* Personalized position: your balance */}
        <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              marginBottom: "6px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <WalletIcon size={14} color="var(--accent-cyan)" />
            Your Balance
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 600, lineHeight: 1.3 }}>
            {walletConnected ? formatCurrency(usdcBalance, "USD", 2) : "—"}
          </div>
        </div>

        {/* Personalized upside: projected annual yield */}
        <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              marginBottom: "6px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Percent size={14} color="var(--accent-cyan)" />
            Projected Annual Yield
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 600, lineHeight: 1.3 }}>
            {walletConnected && projectedAnnualYield > 0
              ? formatCurrency(projectedAnnualYield, "USD", 2)
              : "—"}
          </div>
        </div>
      </div>

      {walletConnected && (
        <div style={{ marginTop: "16px" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%", padding: "14px" }}
            onClick={onDepositClick}
          >
            Deposit USDC to start earning {apy > 0 ? `${apy.toFixed(2)}%` : ""} APY
          </button>
        </div>
      )}
    </section>
  );
};

export default VaultDecisionSummary;
