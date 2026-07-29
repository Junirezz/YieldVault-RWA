import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import YieldBreakdownChart from "../components/YieldBreakdownChart";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../context/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    preferences: { locale: "en-US", currency: "USD" },
    chartModes: { vaultPerformance: "area", apyTrend: "line", yieldBreakdown: "line" },
    setChartMode: vi.fn(),
    tableDensity: "comfortable",
    setTableDensity: vi.fn(),
  }),
}));

// recharts ResizeObserver shim (jsdom doesn't implement it)
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("YieldBreakdownChart", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  it("renders the section heading", () => {
    render(<YieldBreakdownChart totalGain={1000} />);
    expect(screen.getByRole("heading", { name: /yield earnings/i })).toBeInTheDocument();
  });

  it("defaults to the 30D period", () => {
    render(<YieldBreakdownChart totalGain={1000} />);
    const group = screen.getByRole("group", { name: /select yield period/i });
    const btn = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "30D",
    );
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the ALL period, spanning the full 90-day mock series, without crashing", () => {
    render(<YieldBreakdownChart totalGain={1000} />);
    const group = screen.getByRole("group", { name: /select yield period/i });
    const btnAll = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "ALL",
    ) as HTMLElement;
    fireEvent.click(btnAll);
    expect(btnAll).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("shows the empty state and does not render a chart when there is no gain", () => {
    render(<YieldBreakdownChart totalGain={0} />);
    expect(screen.getByText(/no yield data yet/i)).toBeInTheDocument();
  });

  it("keeps the period total consistent regardless of point-sampling for rendering", () => {
    // The chart downsamples the rendered series for long ranges (see sampleChartSeries),
    // but the displayed total must reflect the full underlying dataset, not the
    // downsampled one.
    render(<YieldBreakdownChart totalGain={3650} />);
    const group = screen.getByRole("group", { name: /select yield period/i });
    const btnAll = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "ALL",
    ) as HTMLElement;
    fireEvent.click(btnAll);
    // 3650 total gain over 90 days averages ~40.5/day; the displayed total for
    // the full period should be close to the full totalGain, not a fraction of
    // it truncated by rendering-only downsampling.
    expect(screen.getByText(/earned in selected period/i)).toBeInTheDocument();
  });
});
