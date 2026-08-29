import React, { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import SkeletonChart from "../components/ui/SkeletonChart";
import {
  Activity,
  ChevronRight,
  Info,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "../components/icons";
import { useTranslation } from "../i18n";
import { formatDate, formatPercent } from "../lib/formatters";
import {
  formatLiquidityCadence,
  formatLockup,
  formatSettlement,
} from "../lib/vaultStrategies";
import {
  RISK_GUIDANCE,
  RISK_TIER_LABELS,
  RISK_TIER_RANK,
  computeYieldStats,
  getRelatedStrategies,
  resolveStrategy,
  type YieldStats,
} from "../lib/strategyDetail";
import { useVaultHistory } from "../hooks/useVaultData";
import { triggerDepositIntent } from "../lib/vaultIntentActions";

interface StrategyDetailProps {
  walletAddress?: string | null;
}

const RISK_TIER_COUNT = Object.keys(RISK_TIER_LABELS).length;

function StatBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: "1 1 150px",
        padding: "10px 12px",
        borderRadius: "10px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border-glass)",
      }}
    >
      <div
        style={{
          color: "var(--text-secondary)",
          fontSize: "0.75rem",
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 600 }}>{children}</div>
    </div>
  );
}

function YieldStatRow({ stats }: { stats: YieldStats }) {
  const changeColor =
    stats.changePct >= 0 ? "var(--accent-green)" : "var(--text-error)";
  return (
    <div className="flex gap-md" style={{ flexWrap: "wrap" }}>
      <StatBlock label="Index change">
        <span style={{ color: changeColor }}>
          {stats.changePct >= 0 ? "+" : ""}
          {stats.changePct.toFixed(2)}%
        </span>
      </StatBlock>
      <StatBlock label="Window range">
        {stats.minValue.toFixed(2)} â€“ {stats.maxValue.toFixed(2)}
      </StatBlock>
      <StatBlock label="Window average">
        {stats.averageValue.toFixed(2)}
      </StatBlock>
    </div>
  );
}

/**
 * Strategy detail page (`/strategies/:strategyId`).
 *
 * Gives each catalog strategy a scannable deep-dive: summary and key terms,
 * risk indicators with plain-language guidance, the yield model behind the
 * headline APY, methodology/sources, and historical share-price context.
 */
const StrategyDetail: React.FC<StrategyDetailProps> = ({ walletAddress }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { strategyId = "" } = useParams<{ strategyId: string }>();
  const { data: history = [], isLoading: historyIsLoading } = useVaultHistory();

  const strategy = useMemo(() => resolveStrategy(strategyId), [strategyId]);

  if (!strategy) {
    return (
      <div className="glass-panel" style={{ padding: "32px" }}>
        <PageHeader
          title={t("strategyDetail.notFoundTitle")}
          description={t("strategyDetail.notFoundDesc")}
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Vault Comparison", href: "/compare" },
          ]}
        />
        <EmptyState
          kind="no-results"
          title={t("strategyDetail.notFoundTitle")}
          description={t("strategyDetail.notFoundDesc")}
          icon={<Wallet size={24} />}
          action={{
            label: t("strategyDetail.browseCompare"),
            href: "/compare",
          }}
        />
      </div>
    );
  }

  const guidance = RISK_GUIDANCE[strategy.riskTier];
  const rank = RISK_TIER_RANK[strategy.riskTier];
  const related = getRelatedStrategies(strategy);
  const stats = computeYieldStats(history);
  const isTest = process.env.NODE_ENV === "test";

  const chartData = history.map((point) => ({
    date: point.date,
    index: point.value,
  }));

  return (
    <div className="glass-panel" style={{ padding: "32px" }}>
      <PageHeader
        title={
          <>
            {strategy.name.split(" ")[0]}{" "}
            <span className="text-gradient">{strategy.name.split(" ").slice(1).join(" ")}</span>
          </>
        }
        description={strategy.note}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Vault Comparison", href: "/compare" },
          { label: strategy.name },
        ]}
        statusChips={[
          { label: `${strategy.issuer}`, variant: "cyan" },
          { label: RISK_TIER_LABELS[strategy.riskTier], variant: "purple" },
        ]}
      />

      {/* â”€â”€ Summary hero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section
        className="glass-panel"
        style={{ padding: "24px", background: "var(--bg-muted)", marginBottom: "20px" }}
        aria-labelledby="strategy-summary-heading"
      >
        <h2 id="strategy-summary-heading" style={{ fontSize: "1.1rem", marginBottom: "12px" }}>
          {t("strategyDetail.summaryHeading")}
        </h2>
        <div className="flex gap-md" style={{ flexWrap: "wrap" }}>
          <StatBlock label={t("strategyDetail.netApyLabel")}>
            <span style={{ fontSize: "1.3rem", color: "var(--accent-cyan)" }}>
              {formatPercent(strategy.apyPercent, false, 2)}
            </span>
          </StatBlock>
          <StatBlock label={t("strategyDetail.minimumLabel")}>
            ${strategy.minimumDepositUsd.toLocaleString()} USDC
          </StatBlock>
          <StatBlock label={t("strategyDetail.issuerLabel")}>
            {strategy.issuer}
          </StatBlock>
        </div>
        <div className="flex gap-md" style={{ marginTop: "14px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => triggerDepositIntent(navigate, walletAddress ?? null)}
          >
            <Wallet size={16} />
            {t("strategyDetail.depositCta")}
          </button>
          <Link to="/compare" className="btn btn-secondary">
            {t("strategyDetail.viewCompareCta")}
          </Link>
        </div>
      </section>

      {/* â”€â”€ Key terms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section
        className="glass-panel"
        style={{ padding: "24px", background: "var(--bg-muted)", marginBottom: "20px" }}
        aria-labelledby="strategy-terms-heading"
      >
        <h2 id="strategy-terms-heading" style={{ fontSize: "1.1rem", marginBottom: "12px" }}>
          {t("strategyDetail.metricsHeading")}
        </h2>
        <div className="flex gap-md" style={{ flexWrap: "wrap" }}>
          <StatBlock label={t("strategyDetail.liquidityLabel")}>
            {formatLiquidityCadence(strategy.liquidityDays)}
          </StatBlock>
          <StatBlock label={t("strategyDetail.lockupLabel")}>
            {formatLockup(strategy.lockupDays)}
          </StatBlock>
          <StatBlock label={t("strategyDetail.settlementLabel")}>
            {formatSettlement(strategy.settlementDays)}
          </StatBlock>
          <StatBlock label={t("strategyDetail.minimumLabel")}>
            ${strategy.minimumDepositUsd.toLocaleString()}
          </StatBlock>
        </div>
      </section>

      {/* â”€â”€ Risk profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section
        className="glass-panel"
        style={{ padding: "24px", background: "var(--bg-muted)", marginBottom: "20px" }}
        aria-labelledby="strategy-risk-heading"
      >
        <h2
          id="strategy-risk-heading"
          style={{
            fontSize: "1.1rem",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <ShieldCheck size={18} color={strategy.accent} />
          {t("strategyDetail.riskHeading")}
        </h2>

        <div
          role="img"
          aria-label={`${RISK_TIER_LABELS[strategy.riskTier]} risk`}
          style={{ display: "flex", gap: "6px", maxWidth: "280px", marginBottom: "10px" }}
        >
          {Array.from({ length: RISK_TIER_COUNT }, (_, segment) => (
            <div
              key={segment}
              aria-hidden="true"
              style={{
                height: "8px",
                flex: 1,
                borderRadius: "4px",
                background:
                  segment <= rank ? strategy.accent : "rgba(255,255,255,0.08)",
              }}
            />
          ))}
        </div>

        <p style={{ color: "var(--text-primary)", lineHeight: 1.6, marginBottom: "10px" }}>
          <strong>{RISK_TIER_LABELS[strategy.riskTier]}</strong> â€” {guidance.summary}
        </p>

        <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px" }}>
          {t("strategyDetail.riskFactorsLabel")}
        </div>
        <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {guidance.factors.map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      </section>

      {/* â”€â”€ Yield model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section
        className="glass-panel"
        style={{ padding: "24px", background: "var(--bg-muted)", marginBottom: "20px" }}
        aria-labelledby="strategy-yield-heading"
      >
        <h2
          id="strategy-yield-heading"
          style={{
            fontSize: "1.1rem",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <TrendingUp size={18} color="var(--accent-cyan)" />
          {t("strategyDetail.yieldHeading")}
        </h2>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {t("strategyDetail.yieldModelIntro").replace("{apy}", formatPercent(strategy.apyPercent, false, 2))}
        </p>
        <ul style={{ margin: "10px 0 0", paddingLeft: "20px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <li>{strategy.note}</li>
          <li>{t("strategyDetail.yieldCompounding")}</li>
          <li>{t("strategyDetail.yieldNetOfFees")}</li>
        </ul>
      </section>

      {/* â”€â”€ Methodology & sources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section
        className="glass-panel"
        style={{ padding: "24px", background: "var(--bg-muted)", marginBottom: "20px" }}
        aria-labelledby="strategy-methodology-heading"
      >
        <h2
          id="strategy-methodology-heading"
          style={{
            fontSize: "1.1rem",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Info size={18} color="var(--accent-purple)" />
          {t("strategyDetail.methodologyHeading")}
        </h2>
        <ol style={{ margin: 0, paddingLeft: "20px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <li>{t("strategyDetail.methodologySource")}</li>
          <li>{t("strategyDetail.methodologyNetFigures")}</li>
          <li>{t("strategyDetail.methodologySimulation")}</li>
        </ol>
        <p
          style={{
            marginTop: "10px",
            fontSize: "0.78rem",
            color: "var(--text-warning)",
          }}
        >
          {t("strategyDetail.methodologyDisclaimer")}
        </p>
      </section>

      {/* â”€â”€ Historical performance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section
        className="glass-panel"
        style={{ padding: "24px", background: "var(--bg-muted)", marginBottom: "20px" }}
        aria-labelledby="strategy-history-heading"
      >
        <h2
          id="strategy-history-heading"
          style={{
            fontSize: "1.1rem",
            marginBottom: "4px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Activity size={18} color="var(--accent-cyan)" />
          {t("strategyDetail.historyHeading")}
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.82rem", marginBottom: "16px" }}>
          {t("strategyDetail.historySubtitle")}
        </p>

        {historyIsLoading ? (
          <SkeletonChart height={220} />
        ) : !stats ? (
          <EmptyState
            kind="no-data"
            title={t("strategyDetail.historyEmptyTitle")}
            description={t("strategyDetail.historyEmptyDesc")}
            icon={<Activity size={24} />}
          />
        ) : (
          <>
            <YieldStatRow stats={stats} />
            <div style={{ height: "220px", marginTop: "16px", position: "relative" }}>
              {isTest ? (
                <LineChart data={chartData} width={400} height={220} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} minTickGap={28} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} />
                  <Tooltip
                    formatter={(value: ValueType) => [`${Number(value).toFixed(2)}`, "Index" as NameType]}
                    labelFormatter={(label: unknown) =>
                      formatDate(String(label), { month: "short", day: "numeric", year: "numeric" })
                    }
                  />
                  <Line type="monotone" dataKey="index" stroke={strategy.accent} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                </LineChart>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} minTickGap={28} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} />
                    <Tooltip
                      formatter={(value: ValueType) => [`${Number(value).toFixed(2)}`, "Index" as NameType]}
                      labelFormatter={(label: unknown) =>
                        formatDate(String(label), { month: "short", day: "numeric", year: "numeric" })
                      }
                    />
                    <Line type="monotone" dataKey="index" stroke={strategy.accent} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
      </section>

      {/* â”€â”€ Other strategies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section aria-labelledby="strategy-related-heading">
        <h2 id="strategy-related-heading" style={{ fontSize: "1.05rem", marginBottom: "12px" }}>
          {t("strategyDetail.relatedHeading")}
        </h2>
        <div
          style={{
            display: "grid",
            gap: "16px",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {related.map((entry) => (
            <Link
              key={entry.id}
              to={`/strategies/${entry.id}`}
              className="glass-panel"
              style={{
                padding: "16px",
                textDecoration: "none",
                color: "inherit",
                borderLeft: `3px solid ${entry.accent}`,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <span style={{ fontWeight: 700 }}>{entry.name}</span>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                {formatPercent(entry.apyPercent, false, 2)} APY Â· {RISK_TIER_LABELS[entry.riskTier]} risk
              </span>
              <span
                aria-hidden="true"
                style={{ color: entry.accent, fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
              >
                {t("strategyDetail.viewDetailsLink")} <ChevronRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default StrategyDetail;
