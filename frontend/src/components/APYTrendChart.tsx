import React, { useMemo, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { TrendingUp } from "./icons";
import { usePreferencesContext } from "../context/PreferencesContext";
import { formatDate } from "../lib/formatters";
import { type TimeRange, getCutoffDate, getNow } from "../lib/dateUtils";
import RefreshControl from "./RefreshControl";
import ChartWidgetPlaceholder from "./ui/ChartWidgetPlaceholder";
import ChartDataTable from "./ChartDataTable";
import ChartKeyboardPoints from "./ChartKeyboardPoints";
import { usePolling } from "../hooks/usePolling";
import { useStaleIndicator } from "../hooks/useStaleIndicator";
import { sampleChartSeries } from "../lib/chartSeries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface APYDataPoint {
  date: string;
  /** APY as a percentage, e.g. 5.2 means 5.2% */
  apy: number;
}

interface WindowConfig {
  range: TimeRange;
  label: string;
  color: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WINDOWS: WindowConfig[] = [
  { range: "7D", label: "7D", color: "var(--accent-cyan)" },
  { range: "1M", label: "1M", color: "var(--accent-purple)" },
  { range: "3M", label: "3M", color: "#f59e0b" },
];

/** Selectable windows for comparison overlay */
const ALL_RANGES: TimeRange[] = ["7D", "1M", "3M", "ALL"];
const MAX_RENDER_POINTS = 120;

/** Chart layout constants */
const CHART_HEIGHT = 240;
const CHART_MARGIN = { top: 8, right: 8, left: -16, bottom: 0 };
const YAXIS_WIDTH = 56;

// ─── Mock APY history generator ───────────────────────────────────────────────

function generateAPYHistory(days: number, baseApy = 5.2): APYDataPoint[] {
  const points: APYDataPoint[] = [];
  const MS_PER_DAY = 86_400_000;
  const now = Date.now();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * MS_PER_DAY).toISOString().slice(0, 10);
    const variance = Math.sin(i * 0.18) * 0.4 + Math.cos(i * 0.07) * 0.2;
    const apy = Math.max(baseApy + variance, 0.1);
    points.push({ date, apy: Math.round(apy * 100) / 100 });
  }
  return points;
}

const ALL_HISTORY = generateAPYHistory(90);

// ─── Tooltip ──────────────────────────────────────────────────────────────────

type APYRechartsTooltipProps = TooltipContentProps<ValueType, NameType>;

function APYTooltip({
  active,
  payload,
  label,
  locale,
}: APYRechartsTooltipProps & { locale: string }) {
  if (!active || !payload?.length) return null;
  const entries = payload as ReadonlyArray<{
    name?: string | number;
    value?: number | string;
    color?: string;
  }>;
  return (
    <div
      className="glass-panel"
      style={{
        padding: "10px 14px",
        background: "rgba(13, 14, 18, 0.95)",
        border: "1px solid var(--border-glass)",
        fontSize: "0.82rem",
      }}
    >
      <div style={{ color: "var(--text-secondary)", marginBottom: "6px" }}>
        {label
          ? formatDate(
              label,
              { month: "short", day: "numeric", year: "numeric" },
              locale,
            )
          : ""}
      </div>
      {entries.map((entry, index) => (
        <div
          key={`${String(entry.name ?? "value")}-${index}`}
          style={{ color: entry.color, fontWeight: 600 }}
        >
          {String(entry.name ?? "Value")}:{" "}
          {typeof entry.value === "number"
            ? entry.value.toFixed(2)
            : entry.value}
          % APY
        </div>
      ))}
    </div>
  );
}

const renderTooltip =
  (locale: string) =>
  (props: APYRechartsTooltipProps) =>
    <APYTooltip {...props} locale={locale} />;

// ─── Linear-scale pixel coordinate helper ─────────────────────────────────────

function computeAPYPointCoords(
  data: APYDataPoint[],
  areaWidth: number,
  areaHeight: number,
): Array<{ x: number; y: number }> {
  if (data.length === 0) return [];
  const yValues = data.map((d) => d.apy);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = yMax - yMin || 1;

  return data.map((_, i) => ({
    x:
      data.length === 1
        ? areaWidth / 2
        : (i / (data.length - 1)) * areaWidth,
    y: areaHeight - ((data[i].apy - yMin) / yRange) * areaHeight,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface APYTrendChartProps {
  /** Override history data (useful for tests). Defaults to generated mock data. */
  data?: APYDataPoint[];
}

const APYTrendChart: React.FC<APYTrendChartProps> = ({ data = ALL_HISTORY }) => {
  const { preferences } = usePreferencesContext();
  const locale = preferences.locale;

  const [activeRange, setActiveRange] = useState<TimeRange>("1M");
  const [comparedRanges, setComparedRanges] = useState<Set<TimeRange>>(
    new Set(["7D"]),
  );
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());
  const [isRefetching, setIsRefetching] = useState(false);

  const isTest = process.env.NODE_ENV === "test";

  const refreshFn = useCallback(async () => {
    setIsRefetching(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    setLastUpdated(new Date());
    setIsRefetching(false);
  }, []);

  const polling = usePolling(refreshFn, {
    interval: 60000,
    pauseOnHidden: true,
    pauseOnOffline: true,
  });
  const { isStale, ageText } = useStaleIndicator(lastUpdated);

  const baseData = useMemo(() => {
    if (activeRange === "ALL") return data;
    const cutoff = getCutoffDate(activeRange, getNow());
    return data.filter((p) => new Date(p.date) >= cutoff);
  }, [data, activeRange]);

  const renderData = useMemo(
    () => sampleChartSeries(baseData, MAX_RENDER_POINTS),
    [baseData],
  );

  const chartData = useMemo(() => {
    const windowCutoffs = new Map<TimeRange, Date | null>();
    for (const range of comparedRanges) {
      windowCutoffs.set(
        range,
        range === "ALL" ? null : getCutoffDate(range, getNow()),
      );
    }

    return renderData.map((point) => {
      const row: Record<string, string | number | null> = { date: point.date };
      row[activeRange] = point.apy;
      for (const [range, cutoff] of windowCutoffs) {
        if (range === activeRange) continue;
        const inWindow = cutoff === null || new Date(point.date) >= cutoff;
        row[range] = inWindow ? point.apy : null;
      }
      return row;
    });
  }, [renderData, activeRange, comparedRanges]);

  const isCompactSeries = baseData.length > renderData.length;

  function toggleComparison(range: TimeRange) {
    setComparedRanges((prev) => {
      const next = new Set(prev);
      if (next.has(range)) {
        next.delete(range);
      } else {
        next.add(range);
      }
      return next;
    });
  }

  const windowColor = (range: TimeRange): string =>
    WINDOWS.find((w) => w.range === range)?.color ?? "var(--accent-cyan)";

  const sharedChartProps = {
    data: chartData,
    margin: CHART_MARGIN,
  };

  const renderLines = () =>
    ALL_RANGES.filter(
      (r) => r === activeRange || comparedRanges.has(r),
    ).map((range) => (
      <Line
        key={range}
        type="monotone"
        dataKey={range}
        name={range}
        stroke={windowColor(range)}
        strokeWidth={range === activeRange ? 2.5 : 1.5}
        strokeDasharray={range === activeRange ? undefined : "4 3"}
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
        isAnimationActive={!isCompactSeries}
        animationDuration={isCompactSeries ? 0 : 600}
      />
    ));

  // ─── a11y: data table rows (active range only) ────────────────────────
  const tableRows = useMemo(
    () =>
      renderData.map(
        (d) =>
          [
            formatDate(
              d.date,
              { month: "short", day: "numeric", year: "numeric" },
              locale,
            ),
            `${d.apy.toFixed(2)}%`,
          ] as const,
      ),
    [renderData, locale],
  );

  const summaryLabel = `${renderData.length} data points · active window: ${activeRange}`;

  // ─── a11y: keyboard points (active range) ─────────────────────────────
  const chartAreaWidth = 560;
  const chartAreaHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;

  const keyboardPoints = useMemo(() => {
    const coords = computeAPYPointCoords(
      renderData,
      chartAreaWidth,
      chartAreaHeight,
    );
    return renderData.map((d, i) => ({
      index: i,
      x: coords[i].x,
      y: coords[i].y,
      label: `${formatDate(d.date, { month: "short", day: "numeric", year: "numeric" }, locale)}: ${d.apy.toFixed(2)}% APY`,
    }));
  }, [renderData, locale, chartAreaHeight]);

  const chartArea = {
    left: YAXIS_WIDTH,
    top: CHART_MARGIN.top,
    width: chartAreaWidth,
    height: chartAreaHeight,
  };

  return (
    <section
      className="glass-panel"
      style={{ padding: "24px", background: "var(--bg-muted)" }}
      aria-labelledby="apy-trend-heading"
    >
      {/* Header */}
      <div
        className="flex justify-between items-start"
        style={{ marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}
      >
        <div>
          <h2
            id="apy-trend-heading"
            style={{
              fontSize: "1.1rem",
              marginBottom: "4px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <TrendingUp size={18} color="var(--accent-cyan)" />
            APY Trend
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
            Comparative APY across selectable time windows
          </p>
        </div>

        {/* Primary range selector */}
        <div
          role="group"
          aria-label="Select primary time window"
          className="flex gap-xs"
          style={{
            background: "rgba(255,255,255,0.03)",
            padding: "4px",
            borderRadius: "8px",
            border: "1px solid var(--border-glass)",
          }}
        >
          {ALL_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={activeRange === range}
              onClick={() => setActiveRange(range)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                background:
                  activeRange === range ? "var(--accent-cyan)" : "transparent",
                color:
                  activeRange === range
                    ? "var(--text-inverse)"
                    : "var(--text-secondary)",
                border: "none",
              }}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Comparison toggles */}
      <div
        className="flex gap-xs"
        style={{ marginBottom: "16px", flexWrap: "wrap" }}
        role="group"
        aria-label="Toggle comparison windows"
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            alignSelf: "center",
          }}
        >
          Compare:
        </span>
        {WINDOWS.filter((w) => w.range !== activeRange).map(
          ({ range, label, color }) => {
            const active = comparedRanges.has(range);
            return (
              <button
                key={range}
                type="button"
                aria-pressed={active}
                onClick={() => toggleComparison(range)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  background: active ? `${color}22` : "transparent",
                  color: active ? color : "var(--text-secondary)",
                  border: `1px solid ${active ? color : "var(--border-glass)"}`,
                }}
              >
                {label}
              </button>
            );
          },
        )}
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
          isRefetching={isRefetching}
          lastUpdated={lastUpdated}
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
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--text-warning, #f59e0b)",
                flexShrink: 0,
              }}
            />
            Data may be stale · {ageText}
          </div>
        )}
      </div>

      {/* Chart */}
      <div style={{ height: `${CHART_HEIGHT}px`, position: "relative" }}>
        {data.length === 0 ? (
          <ChartWidgetPlaceholder
            variant="empty"
            title="No APY history yet"
            description="Yield history will appear once the vault records its first observations."
          />
        ) : isTest ? (
          <LineChart {...sharedChartProps} width={400} height={CHART_HEIGHT}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickFormatter={(str: string) =>
                formatDate(str, { month: "short", day: "numeric" }, locale)
              }
              minTickGap={28}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              domain={["auto", "auto"]}
            />
            <Tooltip content={renderTooltip(locale)} />
            <Legend
              wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }}
              formatter={(value: string) => (
                <span style={{ color: "var(--text-secondary)" }}>{value}</span>
              )}
            />
            {renderLines()}
          </LineChart>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart {...sharedChartProps}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.05)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                tickFormatter={(str: string) =>
                  formatDate(str, { month: "short", day: "numeric" }, locale)
                }
                minTickGap={28}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                domain={["auto", "auto"]}
              />
              <Tooltip content={renderTooltip(locale)} />
              <Legend
                wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }}
                formatter={(value: string) => (
                  <span style={{ color: "var(--text-secondary)" }}>{value}</span>
                )}
              />
              {renderLines()}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Keyboard-navigable point overlay */}
        {data.length > 0 && (
          <ChartKeyboardPoints
            points={keyboardPoints}
            chartArea={chartArea}
            aria-label="APY data points — use arrow keys to navigate"
            data-testid="apy-keyboard-points"
          />
        )}
      </div>

      {/* Non-visual data table alternative */}
      {data.length > 0 && (
        <ChartDataTable
          caption="APY trend data"
          columns={["Date", `APY (${activeRange})`]}
          rows={tableRows}
          summaryLabel={summaryLabel}
        />
      )}
    </section>
  );
};

export default React.memo(APYTrendChart);
