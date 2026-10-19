import React, { useMemo } from "react";
import { Activity, TrendingUp, DollarSign, Percent, Briefcase, Share2 } from "./icons";
import { useTranslation } from "../i18n";
import HelpIcon from "./ui/HelpIcon";
import VaultHealthIndicator from "./VaultHealthIndicator";
import { useVaultHealth } from "../hooks/useVaultHealth";
import { formatPercent } from "../lib/formatters";
import type { VaultHealthRecord } from "../lib/vaultHealthApi";

export interface PortfolioOverviewReferralStats {
  total_reward_earned: string | number;
  referral_count: number;
}

export interface PortfolioOverviewProps {
  totalValue: number;
  totalGain: number;
  weightedApy: number;
  activePositions: number;
  holdingsCount: number;
  locale: string;
  formatSensitiveCurrency: (amount: number, withSign?: boolean) => string;
  referralStats?: PortfolioOverviewReferralStats | null;
  /** True when the referral stats query failed, so the card shows an error state. */
  referralStatsError?: boolean;
  onShareClick: () => void;
}

const PortfolioSummaryCard: React.FC<{
  label: React.ReactNode;
  value: string;
  icon: React.ReactNode;
  trend?: string;
  trendPositive?: boolean;
  onClick?: () => void;
  clickable?: boolean;
}> = ({ label, value, icon, trend, trendPositive, onClick, clickable }) => (
  <div
    className="glass-panel"
    style={{
      padding: "24px",
      background: "var(--bg-muted)",
      position: "relative",
      overflow: "hidden",
      border: "1px solid var(--border-glass)",
      transition: "transform 0.2s ease",
      cursor: clickable ? "pointer" : "default",
    }}
    onMouseEnter={(e) =>
      (e.currentTarget.style.transform = clickable ? "translateY(-4px)" : "translateY(-2px)")
    }
    onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    onClick={onClick}
  >
    <div style={{ position: "absolute", top: "-10px", right: "-10px", opacity: 0.05 }}>
      {React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, { size: 80 })}
    </div>
    <div
      className="flex items-center gap-sm"
      style={{ color: "var(--text-secondary)", marginBottom: "12px" }}
    >
      {icon}
      <span className="text-body-sm" style={{ fontWeight: 500, letterSpacing: "0.02em" }}>
        {label}
      </span>
    </div>
    <div
      style={{
        fontSize: "2rem",
        fontWeight: 700,
        fontFamily: "var(--font-display)",
        color: "var(--text-primary)",
      }}
    >
      {value}
    </div>
    {trend && (
      <div
        style={{
          marginTop: "8px",
          fontSize: "0.85rem",
          color: trendPositive ? "var(--accent-cyan)" : "var(--text-error)",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        {trendPositive ? <TrendingUp size={14} /> : <Activity size={14} />}
        {trend}
      </div>
    )}
  </div>
);

function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const VaultHealthCard: React.FC<{ record: VaultHealthRecord }> = ({ record }) => {
  const { t } = useTranslation();

  return (
    <article className="vault-health-card glass-panel" aria-label={record.name}>
      <div className="vault-health-card__header">
        <VaultHealthIndicator
          status={record.status}
          message={record.message}
          vaultName={record.name}
        />
        <div className="vault-health-card__titles">
          <h3 className="vault-health-card__name">{record.name}</h3>
          <span className={`vault-health-card__status vault-health-card__status--${record.status}`}>
            {t(`portfolio.health.${record.status}`)}
          </span>
        </div>
      </div>
      <p className="vault-health-card__message">{record.message}</p>
      <dl className="vault-health-card__meta">
        <div>
          <dt>{t("portfolio.health.latency")}</dt>
          <dd>{formatLatency(record.latencyMs)}</dd>
        </div>
        <div>
          <dt>{t("portfolio.health.uptime")}</dt>
          <dd>{record.uptimePct.toFixed(2)}%</dd>
        </div>
      </dl>
    </article>
  );
};

const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({
  totalValue,
  totalGain,
  weightedApy,
  activePositions,
  holdingsCount,
  locale,
  formatSensitiveCurrency,
  referralStats,
  referralStatsError = false,
  onShareClick,
}) => {
  const { t } = useTranslation();
  const { data: vaultHealth = [], isLoading, isError } = useVaultHealth(true);

  const totalNetValueTrend = useMemo(() => {
    if (totalValue === 0) return "N/A";
    const trendPercent = (totalGain / (totalValue - totalGain)) * 100;
    return Number.isFinite(trendPercent)
      ? `${formatPercent(trendPercent, {
          locale,
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} gain`
      : "N/A";
  }, [locale, totalValue, totalGain]);

  const cumulativeYieldTrend = useMemo(() => {
    if (totalGain === 0) return "--";
    return `${formatSensitiveCurrency(totalGain)} realized`;
  }, [totalGain, formatSensitiveCurrency]);

  const weightedApyTrend = useMemo(() => {
    if (holdingsCount === 0) return "N/A";
    return `${holdingsCount} position${holdingsCount !== 1 ? "s" : ""}`;
  }, [holdingsCount]);

  return (
    <div className="portfolio-overview">
      <div className="portfolio-summary-grid" style={{ marginBottom: "8px" }}>
        <PortfolioSummaryCard
          label={t("portfolio.totalNetValue")}
          value={formatSensitiveCurrency(totalValue)}
          icon={<DollarSign size={20} color="var(--accent-cyan)" />}
          trend={totalNetValueTrend}
          trendPositive={totalGain >= 0}
        />
        <PortfolioSummaryCard
          label={t("portfolio.cumulativeYield")}
          value={formatSensitiveCurrency(totalGain, true)}
          icon={<TrendingUp size={20} color="var(--accent-purple)" />}
          trend={cumulativeYieldTrend}
          trendPositive={totalGain >= 0}
        />
        <PortfolioSummaryCard
          label={
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {t("portfolio.overview.weightedApy")}
              <HelpIcon
                variant="tooltip"
                content={t("portfolio.overview.weightedApyTooltip")}
              />
            </span>
          }
          value={formatPercent(weightedApy, {
            locale,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          icon={<Percent size={20} color="var(--accent-cyan)" />}
          trend={weightedApyTrend}
          trendPositive={true}
        />
        <PortfolioSummaryCard
          label={t("portfolio.activePositions")}
          value={activePositions.toString()}
          icon={<Briefcase size={20} color="var(--text-secondary)" />}
        />
        <PortfolioSummaryCard
          label={
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {t("portfolio.overview.referralEarnings")}
              <HelpIcon variant="tooltip" content={t("portfolio.referralTooltip")} />
            </span>
          }
          value={
            referralStatsError
              ? "—"
              : referralStats
                ? `$${referralStats.total_reward_earned}`
                : "$0.00"
          }
          icon={<TrendingUp size={20} color="var(--accent-green)" />}
          trend={
            referralStatsError
              ? t("portfolio.referralUnavailable")
              : referralStats
                ? `${referralStats.referral_count} referral${referralStats.referral_count !== 1 ? "s" : ""}`
                : "0 referrals"
          }
          trendPositive={!referralStatsError}
        />
        <PortfolioSummaryCard
          label={t("portfolio.shareReferralLink")}
          value=""
          icon={<Share2 size={20} color="var(--accent-cyan)" />}
          onClick={onShareClick}
          clickable={true}
        />
      </div>

      <section className="vault-health-section" aria-labelledby="vault-health-heading">
        <div className="vault-health-section__header">
          <h2 id="vault-health-heading">{t("portfolio.health.title")}</h2>
          <p className="text-body-sm" style={{ color: "var(--text-secondary)" }}>
            {t("portfolio.health.description")}
          </p>
        </div>

        {isLoading && (
          <p className="vault-health-section__status" role="status">
            {t("portfolio.health.loading")}
          </p>
        )}

        {isError && (
          <p className="vault-health-section__status vault-health-section__status--error" role="alert">
            {t("portfolio.health.error")}
          </p>
        )}

        {!isLoading && !isError && vaultHealth.length === 0 && (
          <p className="vault-health-section__status">{t("portfolio.health.empty")}</p>
        )}

        {!isLoading && !isError && vaultHealth.length > 0 && (
          <div className="vault-health-grid">
            {vaultHealth.map((record) => (
              <VaultHealthCard key={record.vaultId} record={record} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default PortfolioOverview;
