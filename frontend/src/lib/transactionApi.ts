import { validate, TransactionQuerySchema } from "./api";

export interface Transaction {
  id: string;
  type: "deposit" | "withdrawal";
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
    amount: op.amount ?? null,
    asset: op.asset_type === "native" ? "XLM" : (op.asset_code ?? null),
    timestamp: op.created_at,
    transactionHash: op.transaction_hash,
  };
}

const HORIZON_BASE_URL = "https://horizon-testnet.stellar.org";

export async function getTransactions(
  params: unknown,
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
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
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
