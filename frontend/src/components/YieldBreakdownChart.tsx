import React, { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "./icons";
import { formatCurrency } from "../lib/formatters";

interface YieldDataPoint {
  date: string;
  yield: number;
}

interface YieldBreakdownChartProps {
  /** Total unrealized gain used to generate mock daily yield data. */
  totalGain: number;
}

type YieldPeriod = "7D" | "30D" | "ALL";

const PERIOD_DAYS: Record<YieldPeriod, number | null> = {
  "7D": 7,
  "30D": 30,
  ALL: null,
};

/** Generate synthetic daily yield data for the past `days` days. */
function generateYieldData(totalGain: number, days: number): YieldDataPoint[] {
  const points: YieldDataPoint[] = [];
  const dailyBase = totalGain / Math.max(days, 1);
  const now = Date.now();
  const MS_PER_DAY = 86_400_000;

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * MS_PER_DAY);
    const dateStr = date.toISOString().slice(0, 10);
    // Add slight variance so the chart looks natural
    const variance = (Math.sin(i * 1.3) * 0.15 + 1) * dailyBase;
    points.push({ date: dateStr, yield: Math.max(variance, 0) });
  }
  return points;
}

interface TooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number }>;
  label?: string;
}

function YieldTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
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
      <div style={{ color: "var(--text-secondary)", marginBottom: "4px" }}>
        {label
          ? new Date(label).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : ""}
      </div>
      <div style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>
        Daily yield: {formatCurrency(value)}
      </div>
    </div>
  );
}

const YieldBreakdownChart: React.FC<YieldBreakdownChartProps> = ({ totalGain }) => {
  const [period, setPeriod] = useState<YieldPeriod>("30D");

  const allData = useMemo(() => generateYieldData(totalGain, 90), [totalGain]);

  const data = useMemo(() => {
    const days = PERIOD_DAYS[period];
    if (days === null) return allData;
    return allData.slice(-days);
  }, [allData, period]);

  const periodTotal = useMemo(
    () => data.reduce((sum, p) => sum + p.yield, 0),
    [data],
  );

  const isEmpty = totalGain === 0;

  return (
    <section
      className="glass-panel"
      style={{ padding: "24px", background: "var(--bg-muted)" }}
      aria-labelledby="yield-chart-heading"
    >
      {/* Header row */}
      <div
        className="flex justify-between items-start"
        style={{ marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}
      >
        <div>
          <h2
            id="yield-chart-heading"
            style={{
              fontSize: "1.1rem",
              marginBottom: "4px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <TrendingUp size={18} color="var(--accent-purple)" />
            Yield Earnings
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
            Daily yield accrued —{" "}
            <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
              {isEmpty ? "$0.00" : formatCurrency(periodTotal)}
            </span>{" "}
            earned in selected period
          </p>
        </div>

        {/* Period toggle */}
        <div
          role="group"
          aria-label="Select yield period"
          className="flex gap-xs"
          style={{
            background: "rgba(255,255,255,0.03)",
            padding: "4px",
            borderRadius: "8px",
            border: "1px solid var(--border-glass)",
          }}
        >
          {(["7D", "30D", "ALL"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                background: period === p ? "var(--accent-purple)" : "transparent",
                color: period === p ? "#fff" : "var(--text-secondary)",
                border: "none",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: "220px", position: "relative" }}>
        {isEmpty ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              fontSize: "0.9rem",
              border: "1px dashed var(--border-glass)",
              borderRadius: "8px",
            }}
            aria-label="No yield data available"
          >
            No yield data yet — deposit to start earning.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              aria-label="Daily yield earnings line chart"
            >
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
                  new Date(str).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
                minTickGap={28}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Tooltip content={YieldTooltip} />
              <Line
                type="monotone"
                dataKey="yield"
                stroke="var(--accent-purple)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "var(--accent-purple)" }}
                animationDuration={600}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
};

export default YieldBreakdownChart;
