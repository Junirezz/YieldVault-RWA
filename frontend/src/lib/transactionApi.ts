import { validate, TransactionQuerySchema } from "./api";
import { formatNumber } from "./formatters";
import type { TransactionQueryInput } from "./api/schemas";

export type TxType = "deposit" | "withdrawal" | "transfer" | "trade";
export type TxStatus = "pending" | "completed" | "failed";

export interface Transaction {
  id: string;
  type: TxType;
  /** Transaction settlement status */
  status: TxStatus;
  amount: string | null;
  asset: string | null;
  timestamp: string; // ISO 8601
  transactionHash: string;
}

interface HorizonPaymentOperation {
  id: string;
  type: "payment" | "create_account";
  from: string;
  to: string;
  amount: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  created_at: string;
  transaction_hash: string;
  /**
   * Present on Horizon operation records. `false` means the surrounding
   * transaction was applied to the ledger but failed, so the operation had
   * no effect.
   */
  transaction_successful?: boolean;
}

interface HorizonOperationsResponse {
  _embedded: {
    records: HorizonPaymentOperation[];
  };
}

export function normalizeOperation(
  op: HorizonPaymentOperation,
  walletAddress: string,
): Transaction {
  const isDeposit = op.to === walletAddress;
  return {
    id: op.id,
    type: isDeposit ? "deposit" : "withdrawal",
    // Horizon operations are always settled on-chain, so they are never
    // "pending" here, but the surrounding transaction can have failed —
    // surface that so the status filter reflects reality.
    status: op.transaction_successful === false ? "failed" : "completed",
    amount: op.amount ?? null,
    asset: op.asset_type === "native" ? "XLM" : (op.asset_code ?? null),
    timestamp: op.created_at,
    transactionHash: op.transaction_hash,
  };
}

const HORIZON_BASE_URL = "https://horizon-testnet.stellar.org";

export async function getTransactions(
  params: TransactionQueryInput,
): Promise<Transaction[]> {
  const query = validate(TransactionQuerySchema, params, "TransactionQuery");
  const url = `${HORIZON_BASE_URL}/accounts/${query.walletAddress}/operations?limit=${query.limit}&order=${query.order}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Horizon API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as HorizonOperationsResponse;
  const records = data._embedded?.records ?? [];

  return records
    .filter((op) => op.type === "payment" || op.type === "create_account")
    .map((op) => normalizeOperation(op, query.walletAddress))
    .filter((tx) => query.type === "all" || tx.type === query.type);
}

// --- Display formatters ---

export function formatAmount(
  amount: string | null,
  asset: string | null,
): string {
  if (amount === null || asset === null) {
    return "—";
  }
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return "—";
  }
  const formatted = formatNumber(num, 2);
  return `${formatted} ${asset}`;
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}
