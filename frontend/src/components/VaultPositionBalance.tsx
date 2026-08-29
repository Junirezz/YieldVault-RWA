import React from "react";
import { useSharePrice } from "../hooks/useSharePrice";
import type { PortfolioHolding } from "../lib/portfolioApi";
import HelpIcon from "./ui/HelpIcon";
import { useTranslation } from "../i18n";

interface VaultPositionBalanceProps {
  holding?: PortfolioHolding;
  isLoading: boolean;
}

function formatAmount(amount: number, maximumFractionDigits: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

const VaultPositionBalance: React.FC<VaultPositionBalanceProps> = ({ holding, isLoading }) => {
  const { t } = useTranslation();
  const { sharePrice, isLoading: isPriceLoading } = useSharePrice();
  const shares = holding?.shares ?? 0;
  const valueUsd = holding?.valueUsd ?? 0;
  const hasPosition = Boolean(holding) && shares > 0;

  return (
    <section
      aria-label={t("vaultDashboard.position.ariaLabel")}
      className="glass-panel"
      style={{
        padding: "16px 18px",
        marginBottom: "24px",
        background: "rgba(0, 240, 255, 0.04)",
        border: "1px solid rgba(0, 240, 255, 0.16)",
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: "14px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>{t("vaultDashboard.position.title")}</h3>
          <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "0.78rem" }}>
            {t("vaultDashboard.position.subtitle")}
          </p>
        </div>
        <HelpIcon
          variant="tooltip"
          label={t("vaultDashboard.position.helpLabel")}
          content={t("vaultDashboard.position.help")}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
        <div>
          <div style={{ color: "var(--text-secondary)", fontSize: "0.76rem", marginBottom: "4px" }}>
            {t("vaultDashboard.position.value")}
          </div>
          <div style={{ fontSize: "1.35rem", fontFamily: "var(--font-display)", fontWeight: 700 }}>
            {isLoading ? t("vaultDashboard.position.loading") : `$${formatAmount(valueUsd, 2)} USDC`}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--text-secondary)", fontSize: "0.76rem", marginBottom: "4px" }}>
            {t("vaultDashboard.position.shares")}
          </div>
          <div style={{ fontSize: "1.35rem", fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--accent-cyan)" }}>
            {isLoading ? t("vaultDashboard.position.loading") : `${formatAmount(shares, 6)} yvUSDC`}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--border-glass)", color: "var(--text-secondary)", fontSize: "0.78rem" }}>
        <span>
          {t("vaultDashboard.position.sharePrice")}: <strong style={{ color: "var(--text-primary)" }}>
            {isPriceLoading && sharePrice === null ? t("vaultDashboard.position.loading") : sharePrice !== null ? `${sharePrice.toFixed(4)} USDC` : t("vaultDashboard.position.unavailable")}
          </strong>
        </span>
        <span>{hasPosition ? t("vaultDashboard.position.accrual") : t("vaultDashboard.position.noPosition")}</span>
      </div>
    </section>
  );
};

export default VaultPositionBalance;