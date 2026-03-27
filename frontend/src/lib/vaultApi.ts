import { apiClient } from "./apiClient";
import { validate, VaultHistoryQuerySchema, DepositRequestSchema, WithdrawalRequestSchema } from "./api";

export interface StrategyMetadata {
  id: string;
  name: string;
  issuer: string;
  network: string;
  rpcUrl: string;
  status: "active" | "inactive";
  description: string;
}

export interface VaultSummary {
  tvl: number;
  apy: number;
  participantCount: number;
  monthlyGrowthPct: number;
  strategyStabilityPct: number;
  assetLabel: string;
  exchangeRate: number;
  networkFeeEstimate: string;
  updatedAt: string;
  strategy: StrategyMetadata;
}

export interface VaultHistoryPoint {
  date: string;
  /** Normalized share price index (100 = baseline). */
  value: number;
}

function isValidHistory(data: unknown): data is VaultHistoryPoint[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every(
      (p) =>
        p !== null &&
        typeof p === "object" &&
        typeof (p as VaultHistoryPoint).date === "string" &&
        typeof (p as VaultHistoryPoint).value === "number",
    )
  );
}

/** Mock series when the API returns no points or is unreachable. */
const MOCK_VAULT_HISTORY: VaultHistoryPoint[] = [
  { date: "2025-09-24", value: 100 },
  { date: "2025-10-01", value: 100.32 },
  { date: "2025-10-08", value: 100.41 },
  { date: "2025-10-15", value: 100.58 },
  { date: "2025-10-22", value: 100.72 },
  { date: "2025-10-29", value: 100.89 },
  { date: "2025-11-05", value: 101.02 },
  { date: "2025-11-12", value: 101.15 },
  { date: "2025-11-19", value: 101.28 },
  { date: "2025-11-26", value: 101.44 },
  { date: "2025-12-03", value: 101.58 },
  { date: "2025-12-10", value: 101.71 },
  { date: "2025-12-17", value: 101.85 },
  { date: "2025-12-24", value: 101.98 },
  { date: "2025-12-31", value: 102.12 },
  { date: "2026-01-07", value: 102.28 },
  { date: "2026-01-14", value: 102.41 },
  { date: "2026-01-21", value: 102.55 },
  { date: "2026-01-28", value: 102.68 },
  { date: "2026-02-04", value: 102.82 },
  { date: "2026-02-11", value: 102.95 },
  { date: "2026-02-18", value: 103.08 },
  { date: "2026-02-25", value: 103.22 },
  { date: "2026-03-04", value: 103.35 },
  { date: "2026-03-11", value: 103.48 },
  { date: "2026-03-18", value: 103.61 },
  { date: "2026-03-25", value: 103.75 },
];


export async function getVaultSummary() {
  return apiClient.get<VaultSummary>("/mock-api/vault-summary.json");
}

export async function getVaultHistory(params?: unknown): Promise<VaultHistoryPoint[]> {
  validate(VaultHistoryQuerySchema, params ?? {}, "VaultHistoryQuery");
  try {
    const data = await apiClient.get<unknown>("/mock-api/vault-history.json");
    if (isValidHistory(data)) {
      return data;
    }
  } catch {
    // Use mock below
  }
  return MOCK_VAULT_HISTORY;
}

export async function submitDeposit(params: unknown) {
  validate(DepositRequestSchema, params, "DepositRequest");
  // Simulate backend interaction
  return new Promise<void>((resolve) => setTimeout(resolve, 2000));
}

export async function submitWithdrawal(params: unknown) {
  validate(WithdrawalRequestSchema, params, "WithdrawalRequest");
  // Simulate backend interaction
  return new Promise<void>((resolve) => setTimeout(resolve, 2000));
}
