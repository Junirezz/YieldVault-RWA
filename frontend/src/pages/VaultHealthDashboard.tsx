import { useState } from "react";
import { useTranslation } from "../i18n";
import { useVaultHealth } from "../hooks/useVaultHealth";
import type { VaultHealthRecord } from "../lib/vaultHealthApi";

type TimeRange = "24h" | "7d" | "30d" | "all";

interface TimeRangeOption {
  label: string;
  value: TimeRange;
}

const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const statusKey = `portfolio.health.${status}` as const;
  return (
    <span
      className={`vault-health-badge vault-health-badge--${status}`}
      role="status"
    >
      {t(statusKey, status)}
    </span>
  );
}

function HealthMetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <div className="health-metric-card">
      <span className="health-metric-card__label">{label}</span>
      <span className="health-metric-card__value">
        {value}
        {trend && (
          <span className={`health-metric-card__trend health-metric-card__trend--${trend}`}>
            {trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "\u2192"}
          </span>
        )}
      </span>
    </div>
  );
}

function VaultHealthRow({ record }: { record: VaultHealthRecord }) {
  return (
    <div className="vault-health-row" role="row">
      <div className="vault-health-row__name" role="cell">
        {record.name}
      </div>
      <div className="vault-health-row__status" role="cell">
        <StatusBadge status={record.status} />
      </div>
      <div className="vault-health-row__latency" role="cell">
        {record.latencyMs}ms
      </div>
      <div className="vault-health-row__uptime" role="cell">
        {record.uptimePct.toFixed(1)}%
      </div>
      <div className="vault-health-row__checked" role="cell">
        {new Date(record.lastCheckedAt).toLocaleTimeString()}
      </div>
      <div className="vault-health-row__message" role="cell">
        {record.message}
      </div>
    </div>
  );
}

const VaultHealthDashboard: React.FC = () => {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const { data: healthRecords, isLoading, error, refetch } = useVaultHealth();

  const healthyCount =
    healthRecords?.filter((r) => r.status === "healthy").length ?? 0;
  const totalCount = healthRecords?.length ?? 0;
  const avgLatency =
    healthRecords && healthRecords.length > 0
      ? Math.round(
          healthRecords.reduce((sum, r) => sum + r.latencyMs, 0) /
            healthRecords.length,
        )
      : 0;

  return (
    <div className="glass-panel vault-health-dashboard">
      <header className="page-header" style={{ textAlign: "center", marginBottom: 32 }}>
        <h1>{t("portfolio.health.title", "Vault Health")}</h1>
        <p style={{ color: "var(--color-text-secondary)", marginTop: 8 }}>
          {t(
            "portfolio.health.description",
            "Live operational status for each vault.",
          )}
        </p>
      </header>

      <div className="vault-health-dashboard__controls">
        <div className="vault-health-dashboard__time-range" role="radiogroup" aria-label="Time range">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={timeRange === opt.value}
              className={`vault-health-dashboard__time-btn${timeRange === opt.value ? " vault-health-dashboard__time-btn--active" : ""}`}
              onClick={() => setTimeRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="vault-health-dashboard__refresh"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing\u2026" : "Refresh"}
        </button>
      </div>

      <div className="vault-health-dashboard__summary" role="group" aria-label="Health summary">
        <HealthMetricCard
          label={t("portfolio.health.healthy", "Healthy")}
          value={`${healthyCount}/${totalCount}`}
        />
        <HealthMetricCard
          label={t("portfolio.health.latency", "Avg Latency")}
          value={`${avgLatency}ms`}
        />
        <HealthMetricCard
          label={t("portfolio.health.uptime", "Uptime")}
          value={
            healthRecords && healthRecords.length > 0
              ? `${(healthRecords.reduce((s, r) => s + r.uptimePct, 0) / healthRecords.length).toFixed(1)}%`
              : "N/A"
          }
        />
      </div>

      {error && (
        <div className="vault-health-dashboard__error" role="alert">
          <p>{t("portfolio.health.error", "Unable to load vault health")}</p>
          <button type="button" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !healthRecords && (
        <div className="vault-health-dashboard__loading" aria-busy="true">
          <p>{t("portfolio.health.loading", "Loading vault health\u2026")}</p>
        </div>
      )}

      {healthRecords && healthRecords.length === 0 && !isLoading && (
        <div className="vault-health-dashboard__empty">
          <p>{t("portfolio.health.empty", "No vault health data available")}</p>
        </div>
      )}

      {healthRecords && healthRecords.length > 0 && (
        <div className="vault-health-dashboard__table" role="table" aria-label="Vault health records">
          <div className="vault-health-row vault-health-row--header" role="row">
            <div role="columnheader">Vault</div>
            <div role="columnheader">Status</div>
            <div role="columnheader">Latency</div>
            <div role="columnheader">Uptime</div>
            <div role="columnheader">Last Checked</div>
            <div role="columnheader">Message</div>
          </div>
          {healthRecords.map((record) => (
            <VaultHealthRow key={record.vaultId} record={record} />
          ))}
        </div>
      )}
    </div>
  );
};

export default VaultHealthDashboard;
