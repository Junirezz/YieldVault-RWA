import React, { useState, useMemo } from "react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TrendingUp } from "./icons";
import { useVaultHistory } from "../hooks/useVaultData";
import { ChartSkeleton } from "./Skeleton";
import { type TimeRange, getNow, getCutoffDate } from "../lib/dateUtils";
import { usePreferencesContext } from "../context/PreferencesContext";
import { formatDate } from "../lib/formatters";
import { formatChartNumber, createChartNumberTickFormatter } from "../lib/chartFormatters";
import RefreshControl from "./RefreshControl";
import { useQueryWithPolling, POLLING_INTERVALS } from "../hooks/useQueryWithPolling";
import { useStaleIndicator } from "../hooks/useStaleIndicator";
import { sampleChartSeries } from "../lib/chartSeries";

const MAX_RENDER_POINTS = 120;

type VaultPerformanceTooltipProps = TooltipContentProps<ValueType, NameType> & {
  locale: string;
};

const VaultPerformanceTooltip = ({
  active,
  payload,
  label,
  locale,
}: VaultPerformanceTooltipProps) => {
  if (active && payload && payload.length) {
    const raw = payload[0]?.value;
    const value = typeof raw === "number" ? raw : undefined;
    if (value === undefined) return null;
    return (
      <div
        className="glass-panel"
        style={{
          padding: "12px",
          background: "rgba(13, 14, 18, 0.95)",
          border: "1px solid var(--border-glass)",
          fontSize: "0.85rem",
        }}
      >
        <div style={{ color: "var(--text-secondary)", marginBottom: "4px" }}>
          {label ? formatDate(label, { month: "short", day: "numeric", year: "numeric" }, locale) : ""}
        </div>
        <div style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>
          Index: {formatChartNumber(value, locale, { maxDecimals: 2 })}
        </div>
      </div>
    );
  }
  return null;
}

const VaultPerformanceChart: React.FC = () => {
  const historyQuery = useVaultHistory();
  const { query, polling, lastUpdated } = useQueryWithPolling(historyQuery, {
    interval: POLLING_INTERVALS.slow,
  });
  const { data: rawData = [], isLoading, isFetching } = query;
  const { isStale, ageText } = useStaleIndicator(lastUpdated);
  const { preferences } = usePreferencesContext();
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const isTest = process.env.NODE_ENV === 'test';
  const locale = preferences.locale;

  const renderTooltip = (props: TooltipContentProps<ValueType, NameType>) => (
    <VaultPerformanceTooltip {...props} locale={locale} />
  );

  const filteredData = useMemo(() => {
    if (!rawData.length) return [];
    
    if (timeRange === "ALL") return rawData;

    const cutoff = getCutoffDate(timeRange, getNow());
    return rawData.filter(point => new Date(point.date) >= cutoff);
  }, [rawData, timeRange]);

  const chartData = useMemo(
    () => sampleChartSeries(filteredData, MAX_RENDER_POINTS),
    [filteredData],
  );

  const isCompactSeries = filteredData.length > chartData.length;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {isLoading ? (
        <ChartSkeleton />
      ) : (
        <>
          <div className="flex justify-between items-start" style={{ marginBottom: "16px" }}>
            <div>
              <h3
                style={{
                  fontSize: "1.1rem",
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <TrendingUp size={18} color="var(--accent-cyan)" />
                Vault Performance
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                yvUSDC share price index (100 = baseline)
              </p>
            </div>

            <div className="flex gap-xs" style={{ background: "rgba(255,255,255,0.03)", padding: "4px", borderRadius: "8px", border: "1px solid var(--border-glass)" }}>
              {(["7D", "1M", "3M", "ALL"] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    background: timeRange === range ? "var(--accent-cyan)" : "transparent",
                    color: timeRange === range ? "black" : "var(--text-secondary)",
                    border: "none",
                  }}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {/* Per-widget refresh control + stale indicator */}
          <div style={{ marginBottom: "16px" }}>
            <RefreshControl
              isPolling={polling.isPolling}
              isPaused={polling.isPaused}
              pauseReason={polling.pauseReason}
              onPause={polling.pause}
              onResume={polling.resume}
              onRefresh={polling.forceRefresh}
              isRefetching={isFetching}
              lastUpdated={lastUpdated ?? undefined}
            />
            {isStale && ageText && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: "6px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.75rem",
                  color: "var(--text-warning, #f59e0b)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-warning, #f59e0b)", flexShrink: 0 }} />
                Data may be stale · {ageText}
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: "260px", position: "relative" }}>
            {isTest ? (
              <AreaChart data={chartData} width={400} height={260} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                  tickFormatter={(str: string) => {
                    return formatDate(str, { month: 'short', day: 'numeric' }, locale);
                  }}
                  minTickGap={30}
                />
                <YAxis 
                  domain={['auto', 'auto']}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                  tickFormatter={createChartNumberTickFormatter(locale, true)}
                />
                <Tooltip content={renderTooltip} />
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="var(--accent-cyan)" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorValue)" 
                  isAnimationActive={!isCompactSeries}
                  animationDuration={isCompactSeries ? 0 : 1200}
                />
              </AreaChart>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                    tickFormatter={(str: string) => {
                      return formatDate(str, { month: 'short', day: 'numeric' }, locale);
                    }}
                    minTickGap={30}
                  />
                  <YAxis 
                    domain={['auto', 'auto']}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                    tickFormatter={createChartNumberTickFormatter(locale, true)}
                  />
                  <Tooltip content={renderTooltip} />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="var(--accent-cyan)" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                    isAnimationActive={!isCompactSeries}
                    animationDuration={isCompactSeries ? 0 : 1200}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default VaultPerformanceChart;
