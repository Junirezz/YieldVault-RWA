import { buildCsvFromRows } from "./exportDownload";
import type { PortfolioHolding } from "./portfolioApi";
import type { Transaction } from "./transactionApi";

function formatStatementAmount(amount: string | null, asset: string | null): string {
  if (amount === null || asset === null) return "—";
  const num = Number.parseFloat(amount);
  if (Number.isNaN(num)) return "—";
  return `${num.toFixed(2)} ${asset}`;
}

function formatStatementTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}

export type AccountStatementFormat = "csv" | "json";

export interface AccountStatementPeriod {
  /** Inclusive ISO date (YYYY-MM-DD) or empty for unbounded */
  startDate?: string;
  /** Inclusive ISO date (YYYY-MM-DD) or empty for unbounded */
  endDate?: string;
}

export interface AccountStatementInput {
  walletAddress: string;
  holdings: PortfolioHolding[];
  transactions: Transaction[];
  period?: AccountStatementPeriod;
  generatedAt?: string;
}

export interface AccountStatementSummary {
  walletAddress: string;
  generatedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalValueUsd: number;
  totalUnrealizedGainUsd: number;
  holdingsCount: number;
  transactionCount: number;
}

export interface AccountStatement {
  summary: AccountStatementSummary;
  holdings: PortfolioHolding[];
  transactions: Transaction[];
}

function toDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function toDayEnd(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999Z`);
}

export function filterTransactionsByPeriod(
  transactions: readonly Transaction[],
  period?: AccountStatementPeriod,
): Transaction[] {
  if (!period?.startDate && !period?.endDate) {
    return [...transactions];
  }

  const start = period.startDate ? toDayStart(period.startDate) : null;
  const end = period.endDate ? toDayEnd(period.endDate) : null;

  return transactions.filter((tx) => {
    const ts = new Date(tx.timestamp);
    if (Number.isNaN(ts.getTime())) return false;
    if (start && ts < start) return false;
    if (end && ts > end) return false;
    return true;
  });
}

export function buildAccountStatement(input: AccountStatementInput): AccountStatement {
  const transactions = filterTransactionsByPeriod(input.transactions, input.period);
  const holdings = [...input.holdings];
  const totalValueUsd = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
  const totalUnrealizedGainUsd = holdings.reduce((sum, h) => sum + h.unrealizedGainUsd, 0);

  return {
    summary: {
      walletAddress: input.walletAddress,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      periodStart: input.period?.startDate ?? null,
      periodEnd: input.period?.endDate ?? null,
      totalValueUsd,
      totalUnrealizedGainUsd,
      holdingsCount: holdings.length,
      transactionCount: transactions.length,
    },
    holdings,
    transactions,
  };
}

export function accountStatementToJson(statement: AccountStatement): string {
  return `${JSON.stringify(statement, null, 2)}\n`;
}

export function accountStatementToCsv(statement: AccountStatement): string {
  const { summary, holdings, transactions } = statement;

  const summarySection = buildCsvFromRows(
    ["field", "value"],
    [
      ["walletAddress", summary.walletAddress],
      ["generatedAt", summary.generatedAt],
      ["periodStart", summary.periodStart ?? ""],
      ["periodEnd", summary.periodEnd ?? ""],
      ["totalValueUsd", String(summary.totalValueUsd)],
      ["totalUnrealizedGainUsd", String(summary.totalUnrealizedGainUsd)],
      ["holdingsCount", String(summary.holdingsCount)],
      ["transactionCount", String(summary.transactionCount)],
    ],
  );

  const holdingsSection = buildCsvFromRows(
    ["section", "id", "asset", "vaultName", "shares", "apy", "valueUsd", "unrealizedGainUsd", "status"],
    holdings.map((h) => [
      "holding",
      h.id,
      h.asset,
      h.vaultName,
      String(h.shares),
      String(h.apy),
      String(h.valueUsd),
      String(h.unrealizedGainUsd),
      h.status,
    ]),
  );

  const transactionsSection = buildCsvFromRows(
    ["section", "date", "type", "status", "amount", "asset", "txHash"],
    transactions.map((tx) => [
      "transaction",
      formatStatementTimestamp(tx.timestamp),
      tx.type,
      tx.status,
      formatStatementAmount(tx.amount, tx.asset),
      tx.asset ?? "",
      tx.transactionHash,
    ]),
  );

  return [
    "# YieldVault Account Statement — Summary",
    summarySection,
    "",
    "# Holdings",
    holdingsSection,
    "",
    "# Transactions",
    transactionsSection,
  ].join("\r\n");
}

export function serializeAccountStatement(
  statement: AccountStatement,
  format: AccountStatementFormat,
): { content: string; mimeType: string; extension: string } {
  if (format === "json") {
    return {
      content: accountStatementToJson(statement),
      mimeType: "application/json;charset=utf-8",
      extension: "json",
    };
  }

  return {
    content: accountStatementToCsv(statement),
    mimeType: "text/csv;charset=utf-8",
    extension: "csv",
  };
}

export function buildAccountStatementFileName(
  walletAddress: string,
  format: AccountStatementFormat,
  generatedAt = new Date(),
): string {
  const day = generatedAt.toISOString().slice(0, 10);
  const shortWallet = walletAddress.slice(0, 6).toLowerCase();
  return `yieldvault_statement_${shortWallet}_${day}.${format === "json" ? "json" : "csv"}`;
}
