import React, { useId } from "react";
import { Percent } from "./icons";
import Badge from "./Badge";
import { useTranslation } from "../i18n";
import {
  BPS_DENOMINATOR,
  effectiveFeeBps,
  formatBpsPercent,
  utilizationTone,
} from "../lib/feeCurve";
import type { VaultFeeInfo } from "../lib/feeCurve";

export interface FeeUtilizationPanelProps {
  /**
   * Fee and utilization state from the vault summary. Omitted when the API
   * did not report it — the panel then explains that rather than implying a
   * zero fee.
   */
  fees?: VaultFeeInfo;
  /** Render placeholders instead of values while the summary is loading. */
  isLoading?: boolean;
}

const TONE_COLORS: Record<string, string> = {
  normal: "var(--accent-cyan)",
  elevated: "var(--text-warning, #f59e0b)",
  high: "var(--text-error, #ff453a)",
};

/**
 * Shows the protocol fee the vault is currently charging and the strategy
 * utilization that fee is derived from.
 *
 * The fee shown is recomputed locally from the reported curve and utilization
 * rather than trusting the API's `effectiveFeeBps` blindly: the two should
 * agree, and when they don't, the curve is the thing the contract will
 * actually apply.
 *
 * Note the utilization here is **strategy** utilization — how much of the
 * vault's capital is deployed — not the deposit-cap utilization that drives
 * the capacity warnings elsewhere on the dashboard.
 */
const FeeUtilizationPanel: React.FC<FeeUtilizationPanelProps> = ({ fees, isLoading = false }) => {
  const { t } = useTranslation();
  const headingId = useId();

  const heading = (
    <h3
      id={headingId}
      style={{
        marginBottom: "4px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "1.1rem",
      }}
    >
      <Percent size={18} color="var(--accent-cyan)" />
      {t("vaultDashboard.feeUtilization.title")}
    </h3>
  );

  const panelStyle: React.CSSProperties = {
    padding: "20px",
    background: "var(--bg-muted)",
    border: "1px solid var(--border-glass)",
    marginBottom: "24px",
  };

  if (isLoading || !fees) {
    return (
      <div role="region" aria-labelledby={headingId} className="glass-panel" style={panelStyle}>
        {heading}
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
          {isLoading
            ? t("vaultDashboard.feeUtilization.loading")
            : t("vaultDashboard.feeUtilization.unavailable")}
        </p>
      </div>
    );
  }

  const feeBps = effectiveFeeBps(fees);
  const utilization = Math.min(Math.max(fees.utilizationBps, 0), BPS_DENOMINATOR);
  const tone = utilizationTone(utilization, fees.curve);
  const barColor = TONE_COLORS[tone];
  const barPercent = (utilization / BPS_DENOMINATOR) * 100;
  const kinkPercent = fees.curve
    ? (fees.curve.optimalUtilizationBps / BPS_DENOMINATOR) * 100
    : null;

  return (
    <div role="region" aria-labelledby={headingId} className="glass-panel" style={panelStyle}>
      <div className="flex items-center justify-between gap-md" style={{ marginBottom: "16px" }}>
        <div>
          {heading}
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            {t("vaultDashboard.feeUtilization.subtitle")}
          </p>
        </div>
        <Badge variant="pill" color={fees.dynamicEnabled ? "cyan" : "default"} size="compact">
          {fees.dynamicEnabled
            ? t("vaultDashboard.feeUtilization.dynamicOn")
            : t("vaultDashboard.feeUtilization.dynamicOff")}
        </Badge>
      </div>

      <div className="flex gap-xl" style={{ marginBottom: "16px", flexWrap: "wrap" }}>
        <div>
          <div
            style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}
          >
            {t("vaultDashboard.feeUtilization.currentFee")}
          </div>
          <div
            data-testid="current-fee"
            style={{ fontSize: "1.25rem", fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            {formatBpsPercent(feeBps)}
          </div>
        </div>
        <div>
          <div
            style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}
          >
            {t("vaultDashboard.feeUtilization.utilization")}
          </div>
          <div
            data-testid="current-utilization"
            style={{
              fontSize: "1.25rem",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              color: barColor,
            }}
          >
            {formatBpsPercent(utilization, 1)}
          </div>
        </div>
        {fees.dynamicEnabled && (
          <div>
            <div
              style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}
            >
              {t("vaultDashboard.feeUtilization.baseFee")}
            </div>
            <div
              data-testid="static-fee"
              style={{ fontSize: "1.25rem", fontFamily: "var(--font-display)", fontWeight: 600 }}
            >
              {formatBpsPercent(fees.staticFeeBps)}
            </div>
          </div>
        )}
      </div>

      <div
        role="meter"
        aria-labelledby={headingId}
        aria-valuenow={Math.round(barPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={t("vaultDashboard.feeUtilization.meterText").replace(
          "{{percent}}",
          formatBpsPercent(utilization, 1),
        )}
        style={{
          position: "relative",
          height: "8px",
          borderRadius: "4px",
          background: "rgba(255, 255, 255, 0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${barPercent}%`,
            height: "100%",
            background: barColor,
            transition: "width 300ms ease",
          }}
        />
        {kinkPercent !== null && (
          <div
            data-testid="utilization-kink"
            aria-hidden="true"
            title={t("vaultDashboard.feeUtilization.kinkLabel")}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${kinkPercent}%`,
              width: "2px",
              background: "var(--text-primary)",
              opacity: 0.5,
            }}
          />
        )}
      </div>

      {fees.dynamicEnabled && fees.curve && (
        <p
          style={{
            margin: "12px 0 0",
            color: "var(--text-secondary)",
            fontSize: "0.8rem",
            lineHeight: 1.4,
          }}
        >
          {t("vaultDashboard.feeUtilization.curveSummary")
            .replace("{{base}}", formatBpsPercent(fees.curve.baseFeeBps))
            .replace("{{optimal}}", formatBpsPercent(fees.curve.optimalFeeBps))
            .replace("{{max}}", formatBpsPercent(fees.curve.maxFeeBps))
            .replace("{{kink}}", formatBpsPercent(fees.curve.optimalUtilizationBps, 0))}
        </p>
      )}
    </div>
  );
};

export default FeeUtilizationPanel;
