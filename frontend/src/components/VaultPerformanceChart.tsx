import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "./icons";
import {
  getVaultHistory,
  type VaultHistoryPoint,
} from "../lib/vaultApi";

function formatTick(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

const chartMargin = { top: 8, right: 12, left: 4, bottom: 8 };

const VaultPerformanceChart: React.FC = () => {
  const [data, setData] = useState<VaultHistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getVaultHistory().then((points) => {
      if (!cancelled) setData(points);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ width: "100%" }}>
      <h3
        style={{
          fontSize: "1.1rem",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <TrendingUp size={18} color="var(--accent-cyan)" />
        Historical performance
      </h3>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: "0.82rem",
          marginBottom: "16px",
        }}
      >
        yvUSDC share price index (100 = baseline)
      </p>
      <div className="vault-chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={chartMargin}>
            <defs>
              <linearGradient id="vaultPerfArea" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--accent-cyan)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor="var(--accent-cyan)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-glass)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatTick}
              tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border-glass)" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: unknown) => (typeof v === "number" ? v.toFixed(1) : String(v))}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-glass)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                fontSize: "0.85rem",
              }}
              labelFormatter={(label: unknown) =>
                typeof label === "string" ? formatTick(label) : String(label)
              }
              formatter={(value: unknown) => [
                typeof value === "number" ? value.toFixed(3) : String(value),
                "Index",
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--accent-cyan)"
              strokeWidth={2}
              fill="url(#vaultPerfArea)"
              isAnimationActive={data.length > 0}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default VaultPerformanceChart;
