import { Contract, rpc, TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";
import { networkConfig } from "../config/network";
import { apiClient } from "./apiClient";
import { validate, VaultHistoryQuerySchema, DepositRequestSchema, WithdrawalRequestSchema } from "./api";

// ─── Share Price Error ────────────────────────────────────────────────────────

export class SharePriceFetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SharePriceFetchError";
  }
}

// ─── Fixed-point decoding ─────────────────────────────────────────────────────

/** 10^18 — the fixed-point divisor used by the vault contract's i128 share price. */
export const FIXED_POINT_DIVISOR = 1_000_000_000_000_000_000n;

export function decodeSharePrice(raw: bigint): number {
  const integerPart = raw / FIXED_POINT_DIVISOR;
  const remainder = raw % FIXED_POINT_DIVISOR;
  return Number(integerPart) + Number(remainder) / Number(FIXED_POINT_DIVISOR);
}

// ─── getSharePrice ────────────────────────────────────────────────────────────

export async function getSharePrice(): Promise<number> {
  if (!networkConfig.contractId) {
    throw new SharePriceFetchError("Vault contract ID is not configured");
  }

  const server = new rpc.Server(networkConfig.rpcUrl);
  const contract = new Contract(networkConfig.contractId);

  const PLACEHOLDER_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const sourceAccount = await server.getAccount(PLACEHOLDER_ADDRESS).catch(() => {
    return {
      accountId: () => PLACEHOLDER_ADDRESS,
      sequenceNumber: () => "0",
      incrementSequenceNumber: () => {},
    };
  });

  const tx = new TransactionBuilder(
    sourceAccount as ConstructorParameters<typeof TransactionBuilder>[0],
    {
      fee: BASE_FEE,
      networkPassphrase: networkConfig.networkPassphrase,
    },
  )
    .addOperation(contract.call("get_share_price"))
    .setTimeout(30)
    .build();

  let simResult: rpc.Api.SimulateTransactionResponse;
  try {
    simResult = await server.simulateTransaction(tx);
  } catch (cause) {
    throw new SharePriceFetchError(
      `RPC call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  if (rpc.Api.isSimulationError(simResult)) {
    throw new SharePriceFetchError(
      `Contract simulation error: ${simResult.error}`,
      { cause: new Error(simResult.error) },
    );
  }

  const returnValue = simResult.result?.retval;
  if (!returnValue) {
    throw new SharePriceFetchError("Contract returned no value");
  }

  const raw = returnValue.i128();
  const rawBigInt = (BigInt(raw.hi().toString()) << 64n) | BigInt(raw.lo().toString());

  return decodeSharePrice(rawBigInt);
}

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
  depositCap: number;
  apy: number;
  participantCount: number;
  monthlyGrowthPct: number;
  strategyStabilityPct: number;
  assetLabel: string;
  exchangeRate: number;
  networkFeeEstimate: string;
  updatedAt: string;
  contractPaused: boolean;
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
  return new Promise<void>((resolve) => setTimeout(resolve, 2000));
}

export async function submitWithdrawal(params: unknown) {
  validate(WithdrawalRequestSchema, params, "WithdrawalRequest");
  return new Promise<void>((resolve) => setTimeout(resolve, 2000));
}

export async function getXlmPrice(): Promise<number> {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd");
    const data = await response.json();
    return data.stellar.usd;
  } catch (error) {
    console.error("Failed to fetch XLM price", error);
    return 0.12;
  }
}

export async function estimateNetworkFee(_params: {
  walletAddress: string;
  amount: number;
  action: "deposit" | "withdraw";
}): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  
  const baseFee = _params.action === "deposit" ? 0.05 : 0.07;
  const randomFactor = 0.95 + Math.random() * 0.1;
  const xlmAmount = baseFee * randomFactor;
  
  return xlmAmount.toFixed(6);
}
