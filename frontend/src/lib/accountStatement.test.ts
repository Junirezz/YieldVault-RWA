import { describe, expect, it } from "vitest";
import {
  buildAccountStatement,
  buildAccountStatementFileName,
  filterTransactionsByPeriod,
  serializeAccountStatement,
} from "./accountStatement";
import type { PortfolioHolding } from "./portfolioApi";
import type { Transaction } from "./transactionApi";
import { buildCsvFromRows, escapeCsvValue } from "./exportDownload";

const holding = (overrides: Partial<PortfolioHolding> = {}): PortfolioHolding => ({
  id: "pos-1",
  asset: "USDC",
  vaultId: "vault-1",
  vaultName: "Sovereign Debt",
  symbol: "yvUSDC",
  shares: 100,
  apy: 0.08,
  valueUsd: 1000,
  unrealizedGainUsd: 25,
  issuer: "YieldVault",
  status: "active",
  ...overrides,
});

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "1",
  type: "deposit",
  status: "completed",
  amount: "100.00",
  asset: "USDC",
  timestamp: "2026-03-15T12:00:00Z",
  transactionHash: "tx-hash-abcdef1234567890abcdef1234567890ab",
  ...overrides,
});

describe("exportDownload helpers", () => {
  it("escapes CSV values containing quotes", () => {
    expect(escapeCsvValue('say "hello"')).toBe('"say ""hello"""');
  });

  it("builds CRLF CSV rows", () => {
    expect(buildCsvFromRows(["a", "b"], [["1", "2"]])).toBe('"a","b"\r\n"1","2"');
  });
});

describe("filterTransactionsByPeriod", () => {
  const rows = [
    tx({ id: "a", timestamp: "2026-01-10T00:00:00Z" }),
    tx({ id: "b", timestamp: "2026-02-15T00:00:00Z" }),
    tx({ id: "c", timestamp: "2026-03-20T00:00:00Z" }),
  ];

  it("returns all rows when no period is set", () => {
    expect(filterTransactionsByPeriod(rows)).toHaveLength(3);
  });

  it("filters by inclusive start and end dates", () => {
    const filtered = filterTransactionsByPeriod(rows, {
      startDate: "2026-02-01",
      endDate: "2026-03-15",
    });
    expect(filtered.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("buildAccountStatement", () => {
  it("aggregates holdings and period-filtered transactions", () => {
    const statement = buildAccountStatement({
      walletAddress: "GABC123",
      holdings: [holding(), holding({ id: "pos-2", valueUsd: 500, unrealizedGainUsd: -10 })],
      transactions: [
        tx({ id: "in", timestamp: "2026-02-01T00:00:00Z" }),
        tx({ id: "out", timestamp: "2026-06-01T00:00:00Z" }),
      ],
      period: { startDate: "2026-01-01", endDate: "2026-03-31" },
      generatedAt: "2026-07-29T12:00:00.000Z",
    });

    expect(statement.summary).toMatchObject({
      walletAddress: "GABC123",
      generatedAt: "2026-07-29T12:00:00.000Z",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      totalValueUsd: 1500,
      totalUnrealizedGainUsd: 15,
      holdingsCount: 2,
      transactionCount: 1,
    });
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0].id).toBe("in");
  });
});

describe("serializeAccountStatement", () => {
  it("serializes CSV with summary, holdings, and transactions sections", () => {
    const statement = buildAccountStatement({
      walletAddress: "GABC123",
      holdings: [holding()],
      transactions: [tx()],
      generatedAt: "2026-07-29T12:00:00.000Z",
    });

    const { content, mimeType, extension } = serializeAccountStatement(statement, "csv");
    expect(extension).toBe("csv");
    expect(mimeType).toContain("text/csv");
    expect(content).toContain("YieldVault Account Statement");
    expect(content).toContain("GABC123");
    expect(content).toContain("Sovereign Debt");
    expect(content).toContain("deposit");
  });

  it("serializes JSON with nested summary", () => {
    const statement = buildAccountStatement({
      walletAddress: "GABC123",
      holdings: [holding()],
      transactions: [tx()],
      generatedAt: "2026-07-29T12:00:00.000Z",
    });

    const { content, mimeType, extension } = serializeAccountStatement(statement, "json");
    expect(extension).toBe("json");
    expect(mimeType).toContain("application/json");
    const parsed = JSON.parse(content);
    expect(parsed.summary.walletAddress).toBe("GABC123");
    expect(parsed.holdings).toHaveLength(1);
    expect(parsed.transactions).toHaveLength(1);
  });
});

describe("buildAccountStatementFileName", () => {
  it("includes a short wallet prefix and ISO date", () => {
    expect(
      buildAccountStatementFileName("GABCDEFGHIJKLMNOP", "csv", new Date("2026-07-29T00:00:00Z")),
    ).toBe("yieldvault_statement_gabcde_2026-07-29.csv");
  });
});
