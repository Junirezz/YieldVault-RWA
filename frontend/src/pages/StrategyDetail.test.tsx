import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import StrategyDetail from "./StrategyDetail";
import { computeYieldStats, resolveStrategy } from "../lib/strategyDetail";

vi.mock("../hooks/useVaultData", () => ({
  useVaultHistory: vi.fn(),
  useVaultSummary: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

import { useVaultHistory } from "../hooks/useVaultData";

const mockedUseVaultHistory = vi.mocked(useVaultHistory);

const HISTORY = [
  { date: "2026-01-01", value: 100 },
  { date: "2026-02-01", value: 101.5 },
  { date: "2026-03-01", value: 103.2 },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/strategies/:strategyId" element={<StrategyDetail />} />
        <Route path="/compare" element={<div>Compare page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedUseVaultHistory.mockReturnValue({
    data: HISTORY,
    isLoading: false,
  } as unknown as ReturnType<typeof useVaultHistory>);
});

describe("StrategyDetail", () => {
  it("renders the summary, risk profile, yield model and methodology for a known strategy", async () => {
    renderAt("/strategies/benji");

    await waitFor(() => {
      expect(screen.getByText("Franklin")).toBeInTheDocument();
    });

    expect(screen.getAllByText(/8\.45%/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: /risk profile/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /yield model/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /methodology & sources/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /moderate risk/i })).toBeInTheDocument();
  });

  it("resolves dashboard strategy ids such as stellar-benji to their catalog entry", async () => {
    renderAt("/strategies/stellar-benji");
    await waitFor(() => {
      expect(screen.getByText("Franklin")).toBeInTheDocument();
    });
  });

  it("shows an empty state with a link to the comparison screen for unknown ids", async () => {
    renderAt("/strategies/does-not-exist");

    expect((await screen.findAllByText(/strategy not found/i)).length).toBeGreaterThan(0);
    const cta = screen.getByRole("link", { name: /browse all strategies/i });
    expect(cta).toHaveAttribute("href", "/compare");
  });

  it("shows historical stats and links to related strategies when history exists", async () => {
    renderAt("/strategies/treasury-ladder");

    await waitFor(() => {
      expect(screen.getByText(/window average/i)).toBeInTheDocument();
    });
    expect(screen.getByText("+3.20%")).toBeInTheDocument();

    const benjiLink = screen.getByRole("link", {
      name: /Franklin BENJI Connector/i,
    });
    expect(benjiLink).toHaveAttribute("href", "/strategies/benji");
  });

  it("falls back to the empty history state when no share-price points exist", async () => {
    mockedUseVaultHistory.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useVaultHistory>);

    renderAt("/strategies/benji");

    expect(await screen.findByText(/no history recorded yet/i)).toBeInTheDocument();
  });
});

describe("resolveStrategy", () => {
  it("matches exact ids case-insensitively", () => {
    expect(resolveStrategy("BENJI")?.id).toBe("benji");
  });

  it("matches by display name", () => {
    expect(resolveStrategy("Private Credit Income")?.id).toBe("credit-income");
  });

  it("matches catalog ids contained inside longer external ids", () => {
    expect(resolveStrategy("stellar-benji")?.id).toBe("benji");
  });

  it("returns undefined for unknown slugs and empty input", () => {
    expect(resolveStrategy("nope")).toBeUndefined();
    expect(resolveStrategy("   ")).toBeUndefined();
  });
});

describe("computeYieldStats", () => {
  it("summarises change, range and average across the window", () => {
    const stats = computeYieldStats(HISTORY);
    expect(stats).not.toBeNull();
    expect(stats!.changePct).toBeCloseTo(3.2, 5);
    expect(stats!.minValue).toBe(100);
    expect(stats!.maxValue).toBe(103.2);
    expect(stats!.averageValue).toBeCloseTo((100 + 101.5 + 103.2) / 3, 5);
    expect(stats!.pointCount).toBe(3);
  });

  it("returns null for an empty series", () => {
    expect(computeYieldStats([])).toBeNull();
  });
});
