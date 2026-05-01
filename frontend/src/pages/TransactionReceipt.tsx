import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

const HORIZON_BASE = "https://horizon-testnet.stellar.org";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";

interface TxDetails {
  hash: string;
  created_at: string;
  fee_charged: string;
  source_account: string;
  operation_count: number;
  memo?: string;
  // Derived from first payment operation
  type?: "deposit" | "withdrawal";
  amount?: string;
  asset?: string;
}

interface HorizonTx {
  hash: string;
  created_at: string;
  fee_charged: string;
  source_account: string;
  operation_count: number;
  memo?: string;
}

interface HorizonOp {
  type: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  from?: string;
  to?: string;
}

export default function TransactionReceipt() {
  const { txHash } = useParams<{ txHash: string }>();
  const [tx, setTx] = useState<TxDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!txHash) return;

    async function fetchTx() {
      try {
        const [txRes, opsRes] = await Promise.all([
          fetch(`${HORIZON_BASE}/transactions/${txHash}`),
          fetch(`${HORIZON_BASE}/transactions/${txHash}/operations`),
        ]);

        if (!txRes.ok) throw new Error(`Transaction not found (${txRes.status})`);

        const txData = (await txRes.json()) as HorizonTx;
        const opsData = opsRes.ok
          ? (await opsRes.json() as { _embedded: { records: HorizonOp[] } })
          : null;

        const paymentOp = opsData?._embedded?.records?.find(
          (op) => op.type === "payment",
        );

        setTx({
          hash: txData.hash,
          created_at: txData.created_at,
          fee_charged: txData.fee_charged,
          source_account: txData.source_account,
          operation_count: txData.operation_count,
          memo: txData.memo,
          type: paymentOp ? "deposit" : undefined,
          amount: paymentOp?.amount,
          asset:
            paymentOp?.asset_type === "native"
              ? "XLM"
              : (paymentOp?.asset_code ?? undefined),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load transaction");
      } finally {
        setLoading(false);
      }
    }

    void fetchTx();
  }, [txHash]);

  if (loading) {
    return (
      <div className="receipt-page">
        <p className="receipt-loading">Loading transaction…</p>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="receipt-page">
        <p className="receipt-error">{error ?? "Transaction not found."}</p>
        <Link to="/" className="receipt-back-link">← Back to app</Link>
      </div>
    );
  }

  const feeXlm = (parseInt(tx.fee_charged, 10) / 1e7).toFixed(7);
  const date = new Date(tx.created_at).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <div className="receipt-page">
      <div className="receipt-card" role="main" aria-label="Transaction Receipt">
        <header className="receipt-header">
          <h1 className="receipt-title">Transaction Receipt</h1>
          <p className="receipt-subtitle">YieldVault · Stellar Network</p>
        </header>

        <dl className="receipt-fields">
          <div className="receipt-row">
            <dt>Date</dt>
            <dd>{date}</dd>
          </div>
          {tx.type && (
            <div className="receipt-row">
              <dt>Type</dt>
              <dd className={`receipt-badge receipt-badge--${tx.type}`}>
                {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
              </dd>
            </div>
          )}
          {tx.amount && tx.asset && (
            <div className="receipt-row">
              <dt>Amount</dt>
              <dd>
                {parseFloat(tx.amount).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 7,
                })}{" "}
                {tx.asset}
              </dd>
            </div>
          )}
          <div className="receipt-row">
            <dt>Network Fee</dt>
            <dd>{feeXlm} XLM</dd>
          </div>
          <div className="receipt-row">
            <dt>Wallet Address</dt>
            <dd className="receipt-mono receipt-truncate" title={tx.source_account}>
              {tx.source_account}
            </dd>
          </div>
          <div className="receipt-row">
            <dt>Transaction Hash</dt>
            <dd className="receipt-mono receipt-truncate" title={tx.hash}>
              <a
                href={`${EXPLORER_BASE}/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="receipt-explorer-link"
              >
                {tx.hash}
              </a>
            </dd>
          </div>
          {tx.memo && (
            <div className="receipt-row">
              <dt>Memo</dt>
              <dd>{tx.memo}</dd>
            </div>
          )}
        </dl>

        <div className="receipt-actions no-print">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
          >
            Print Receipt
          </button>
          <Link to="/transactions" className="btn btn-secondary">
            View All Transactions
          </Link>
        </div>
      </div>
    </div>
  );
}
