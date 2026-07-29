import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import axe from "axe-core";
import VaultComparison from "./VaultComparison";
import { MAX_COMPARISON_SELECTION } from "../lib/vaultStrategies";


/** The strategy names in column order, skipping the leading "Metric" header. */
function columnNames(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("columnheader")
    .slice(1)
    .map((header) => header.textContent ?? "");
}

function cardButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

function announcement(): string {
  return screen.getByTestId("comparison-announcement").textContent ?? "";
}

/** The sort control living in a metric's row header. */
function sortButton(metric: string) {
  return screen.getByRole("button", {
    name: new RegExp(`Order comparison by ${metric}\\.`, "i"),
  });
}

/** The value cells of a metric row, in column order. */
function metricRow(metric: string): HTMLElement[] {
  const row = sortButton(metric).closest("tr");
  if (!row) throw new Error(`No row found for ${metric}`);
  return within(row).getAllByRole("cell");
}

/** The `<th>` wrapping a metric's sort control, which carries `aria-sort`. */
function metricRowHeader(metric: string): HTMLElement {
  const header = sortButton(metric).closest("th");
  if (!header) throw new Error(`No row header found for ${metric}`);
  return header;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderComparison(initialEntries: string | string[] = ["/compare"]) {
  const entries = Array.isArray(initialEntries) ? initialEntries : [initialEntries];
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="/compare" element={<VaultComparison />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VaultComparison", () => {
  it("renders selected strategies and lets users compare them", () => {
    renderComparison();

    expect(screen.getByRole("heading", { name: /Compare Vault Strategies/i })).toBeInTheDocument();
    expect(screen.getByText(/Side-by-side comparison/i)).toBeInTheDocument();
    const franklinMatches = screen.getAllByText(/Franklin BENJI Connector/i);
    expect(franklinMatches.length).toBeGreaterThan(0);
    const tokenizedMatches = screen.getAllByText(/Tokenized Treasury Ladder/i);
    expect(tokenizedMatches.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Franklin BENJI Connector/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tokenized Treasury Ladder/i })).toBeInTheDocument();
  });

  it("renders the default two-strategy comparison", () => {
    renderComparison();

    expect(
      screen.getByRole("heading", { name: /Compare Vault Strategies/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Side-by-side comparison/i }),
    ).toBeInTheDocument();
    expect(columnNames()).toHaveLength(2);
    expect(columnNames()[0]).toMatch(/Franklin BENJI Connector/);
    expect(columnNames()[1]).toMatch(/Tokenized Treasury Ladder/);
  });

  it("offers every catalog strategy as a selectable card", () => {
    renderComparison();

    const group = screen.getByRole("group", {
      name: /Vault strategies available for comparison/i,
    });
    expect(within(group).getAllByRole("button")).toHaveLength(4);
    expect(cardButton(/Franklin BENJI Connector/i)).toHaveAttribute("aria-pressed", "true");
    expect(cardButton(/Liquidity Buffer/i)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/2 of 3 selected/i)).toBeInTheDocument();
  });

  it("adds a strategy to the comparison and announces it", () => {
    renderComparison();

    fireEvent.click(cardButton(/Liquidity Buffer/i));

    expect(columnNames()).toHaveLength(3);
    expect(announcement()).toMatch(
      /Liquidity Buffer added to the comparison\. 3 of 3 selected\./i,
    );
  });

  it("removes a strategy and announces it", () => {
    renderComparison("/compare?strategies=benji,treasury-ladder,credit-income");

    fireEvent.click(cardButton(/Private Credit Income/i));

    expect(columnNames()).toHaveLength(2);
    expect(announcement()).toMatch(/Private Credit Income removed from the comparison/i);
  });

  it("blocks selection past the cap and explains why instead of ignoring the click", () => {
    renderComparison("/compare?strategies=benji,treasury-ladder,credit-income");

    const blocked = cardButton(/Liquidity Buffer/i);
    expect(blocked).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(blocked);

    expect(columnNames()).toHaveLength(MAX_COMPARISON_SELECTION);
    expect(blocked).toHaveAttribute("aria-pressed", "false");
    expect(announcement()).toMatch(
      /Comparison limit of 3 reached\. Deselect a strategy before adding Liquidity Buffer\./i,
    );
  });

  it("keeps already-selected cards actionable at the cap", () => {
    renderComparison("/compare?strategies=benji,treasury-ladder,credit-income");

    expect(cardButton(/Franklin BENJI Connector/i)).not.toHaveAttribute("aria-disabled");
  });

  it("restores the selection encoded in the URL", () => {
    renderComparison("/compare?strategies=liquidity-buffer,credit-income");

    expect(columnNames()[0]).toMatch(/Liquidity Buffer/);
    expect(columnNames()[1]).toMatch(/Private Credit Income/);
    expect(cardButton(/Franklin BENJI Connector/i)).toHaveAttribute("aria-pressed", "false");
  });

  it("ignores unknown strategy ids in the URL", () => {
    renderComparison("/compare?strategies=benji,not-a-strategy");

    expect(screen.getByText(/1 of 3 selected/i)).toBeInTheDocument();
    expect(screen.getByText(/Select at least two strategies/i)).toBeInTheDocument();
  });

  it("does not add a fourth strategy once the max selection is reached", () => {
    renderComparison();

    fireEvent.click(screen.getByRole("button", { name: /Private Credit Income/i }));
    expect(screen.getAllByText(/3 of 3 selected/i).length).toBeGreaterThan(0);

    const fourthCard = screen.getByRole("button", { name: /Liquidity Buffer/i });
    expect(fourthCard).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(fourthCard);

    expect(screen.getAllByText(/3 of 3 selected/i).length).toBeGreaterThan(0);
    expect(fourthCard).toHaveAttribute("aria-pressed", "false");
  });

  it("navigates to the deposit tab when allocating to selected strategies", () => {
    renderComparison();

    fireEvent.click(screen.getByRole("button", { name: /Allocate to selected/i }));

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/?tab=deposit");
  });

  it("restores the selection from the strategies URL param", () => {
    renderComparison(["/compare?strategies=benji,credit-income"]);

    expect(screen.getAllByText(/2 of 3 selected/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Franklin BENJI Connector/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Private Credit Income/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Tokenized Treasury Ladder/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Liquidity Buffer/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("highlights the best APY cell in the comparison table", () => {
    renderComparison(["/compare?strategies=benji,credit-income"]);

    const bestCell = screen.getByRole("table").querySelector('td[data-best="true"]');
    expect(bestCell).not.toBeNull();
    expect(bestCell).toHaveTextContent("9.15%");
  });

  it("caps an over-long URL selection", () => {
    renderComparison(
      "/compare?strategies=benji,treasury-ladder,credit-income,liquidity-buffer",
    );

    expect(columnNames()).toHaveLength(MAX_COMPARISON_SELECTION);
    expect(cardButton(/Liquidity Buffer/i)).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the empty state when fewer than two strategies are selected", () => {
    renderComparison();

    fireEvent.click(cardButton(/Tokenized Treasury Ladder/i));
    expect(screen.getByText(/One more strategy is needed/i)).toBeInTheDocument();

    fireEvent.click(cardButton(/Franklin BENJI Connector/i));
    expect(screen.getByText(/Select at least two strategies/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is selected yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("restores the default selection when reset", () => {
    renderComparison("/compare?strategies=liquidity-buffer,credit-income");

    fireEvent.click(screen.getByRole("button", { name: /^Reset$/ }));

    expect(columnNames()[0]).toMatch(/Franklin BENJI Connector/);
    expect(columnNames()[1]).toMatch(/Tokenized Treasury Ladder/);
    expect(announcement()).toMatch(/reset to the default selection/i);
  });

  it("reorders columns by a metric, best value first", () => {
    renderComparison("/compare?strategies=treasury-ladder,benji");

    expect(columnNames()[0]).toMatch(/Tokenized Treasury Ladder/);

    fireEvent.click(sortButton("APY"));

    // APY is higher-is-better, so the first click sorts descending.
    expect(columnNames()[0]).toMatch(/Franklin BENJI Connector/);
    expect(announcement()).toMatch(/ordered by APY, descending/i);
  });

  it("flips the direction when the active metric is clicked again", () => {
    renderComparison("/compare?strategies=treasury-ladder,benji");

    fireEvent.click(sortButton("APY"));
    fireEvent.click(sortButton("APY"));

    expect(columnNames()[0]).toMatch(/Tokenized Treasury Ladder/);
    expect(announcement()).toMatch(/ordered by APY, ascending/i);
  });

  it("exposes the sorted metric through aria-sort", () => {
    renderComparison();

    expect(metricRowHeader("APY")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(sortButton("APY"));

    expect(metricRowHeader("APY")).toHaveAttribute("aria-sort", "descending");
    expect(metricRowHeader("Risk")).toHaveAttribute("aria-sort", "none");
  });

  it("names each metric row header for assistive technology", () => {
    renderComparison();

    expect(
      screen.getAllByRole("rowheader").map((header) => header.textContent),
    ).toEqual(["APY", "Liquidity", "Lockup", "Risk", "Settlement", "Minimum deposit"]);
  });

  it("marks the best value in a row with a text cue, not colour alone", () => {
    renderComparison("/compare?strategies=benji,treasury-ladder");

    const [benjiApy, treasuryApy] = metricRow("APY");

    expect(benjiApy).toHaveTextContent("8.45%");
    expect(benjiApy).toHaveTextContent(/\(best APY\)/i);
    expect(treasuryApy).toHaveTextContent("7.9%");
    expect(treasuryApy).not.toHaveTextContent(/\(best APY\)/i);
  });

  it("marks no winner when a metric ties across the selection", () => {
    // Both strategies have a zero-day lockup, so the row has no signal to give.
    renderComparison("/compare?strategies=benji,treasury-ladder");

    metricRow("Lockup").forEach((cell) => {
      expect(cell).toHaveTextContent("None");
      expect(cell).not.toHaveTextContent(/\(best Lockup\)/i);
    });
  });

  it("formats metrics for humans rather than showing raw day counts", () => {
    renderComparison("/compare?strategies=benji,credit-income");

    const [benjiSettlement] = metricRow("Settlement");
    expect(benjiSettlement).toHaveTextContent(/Immediate \(T\+0\)/);

    const [, creditLiquidity] = metricRow("Liquidity");
    expect(creditLiquidity).toHaveTextContent("Weekly");

    const [benjiMinimum] = metricRow("Minimum deposit");
    expect(benjiMinimum).toHaveTextContent("$100");
  });

  it("summarises the highest APY and the spread across the selection", () => {
    renderComparison("/compare?strategies=benji,liquidity-buffer");

    expect(
      screen.getByText(/Highest APY: Franklin BENJI Connector \(8\.45%\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/APY spread: 3\.25%/i)).toBeInTheDocument();
  });
});

describe("VaultComparison accessibility", () => {
  async function auditNoViolations(container: HTMLElement) {
    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
      // The page renders without the app shell here, so landmark rules that
      // depend on it are out of scope for this audit.
      rules: { region: { enabled: false } },
    });

    const violations = results.violations.map(
      (violation) =>
        `[${violation.impact}] ${violation.id}: ${violation.description}\n` +
        violation.nodes.map((node) => `  → ${node.html}`).join("\n"),
    );

    expect(
      violations,
      `axe found ${violations.length} violation(s):\n${violations.join("\n\n")}`,
    ).toHaveLength(0);
  }

  it("has no axe violations with a comparison rendered", async () => {
    const { container } = renderComparison(
      "/compare?strategies=benji,treasury-ladder,credit-income",
    );

    await auditNoViolations(container);
  });

  it("has no axe violations in the empty state", async () => {
    const { container } = renderComparison("/compare?strategies=");

    await auditNoViolations(container);
  });
});
