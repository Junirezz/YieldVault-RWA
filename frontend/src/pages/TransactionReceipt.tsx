import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import EmptyState from "../components/ui/EmptyState";

const HORIZON_BASE = "https://horizon-testnet.stellar.org";
const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";

interface TxDetails {
  hash: string;
  created_at: string;
  fee_charged: string;
  source_account: string;
  operation_count: number;
  memo?: string;
  type?: "deposit" | "withdrawal";
  amount?: string;
  asset?: string;
  status: "pending" | "completed" | "failed";
  confirmations: number;
  ledger?: number;
  explorerUrl: string;
  horizonUrl: string;
}

interface HorizonTx {
  hash: string;
  created_at: string;
  fee_charged: string;
  source_account: string;
  operation_count: number;
  memo?: string;
  ledger?: number;
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
  const [pollCount, setPollCount] = useState(0);

  const fetchTx = useCallback(async () => {
    if (!txHash) return;

    try {
      const [txRes, opsRes] = await Promise.all([
        fetch(`${HORIZON_BASE}/transactions/${txHash}`),
        fetch(`${HORIZON_BASE}/transactions/${txHash}/operations`),
      ]);

      if (!txRes.ok) {
        if (txRes.status === 404 && pollCount < 10) {
          // Transaction not yet indexed — keep polling
          setPollCount((c) => c + 1);
          return;
        }
        throw new Error(`Transaction not found (${txRes.status})`);
      }

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
        status: "completed",
        confirmations: txData.ledger ? Math.max(1, txData.ledger) : 1,
        ledger: txData.ledger,
        explorerUrl: `${EXPLORER_BASE}/${txHash}`,
        horizonUrl: `${HORIZON_BASE}/transactions/${txHash}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transaction");
    } finally {
      setLoading(false);
    }
  }, [txHash, pollCount]);

  useEffect(() => {
    void fetchTx();
  }, [fetchTx]);

  // Poll while transaction is not yet found (pending confirmation)
  useEffect(() => {
    if (loading || tx) return;
    const timer = setTimeout(() => {
      setPollCount((c) => c + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [loading, tx, pollCount]);

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
        <EmptyState
          kind="error"
          title="Transaction not found"
          description={error ?? "We could not find this transaction receipt."}
          action={{ label: "Back to app", href: "/" }}
          className="receipt-empty-state"
        />
      </div>
    );
  }

  const feeXlm = (parseInt(tx.fee_charged, 10) / 1e7).toFixed(7);
  const date = new Date(tx.created_at).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const handleExportJson = () => {
    const exportData = {
      receiptVersion: 1,
      transactionHash: tx.hash,
      type: tx.type,
      amount: tx.amount,
      asset: tx.asset,
      fee: feeXlm + " XLM",
      walletAddress: tx.source_account,
      date: tx.created_at,
      status: tx.status,
      ledger: tx.ledger,
      explorerUrl: tx.explorerUrl,
      horizonUrl: tx.horizonUrl,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${tx.hash.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="receipt-page">
      <div className="receipt-card" role="main" aria-label="Transaction Receipt">
        <header className="receipt-header">
          <h1 className="receipt-title">Transaction Receipt</h1>
          <p className="receipt-subtitle">YieldVault · Stellar Network</p>
          <div className="receipt-status">
            <span className={`receipt-status-badge receipt-status-badge--${tx.status}`}>
              {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
            </span>
          </div>
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
                href={tx.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="receipt-explorer-link"
              >
                {tx.hash}
              </a>
            </dd>
          </div>
          {tx.ledger && (
            <div className="receipt-row">
              <dt>Ledger</dt>
              <dd>
                <a
                  href={`${EXPLORER_BASE}/ledger/${tx.ledger}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="receipt-explorer-link"
                >
                  #{tx.ledger}
                </a>
              </dd>
            </div>
          )}
          <div className="receipt-row">
            <dt>Confirmations</dt>
            <dd>{tx.confirmations}</dd>
          </div>
          {tx.memo && (
            <div className="receipt-row">
              <dt>Memo</dt>
              <dd>{tx.memo}</dd>
            </div>
          )}
        </dl>

        <div className="receipt-links">
          <a
            href={tx.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="receipt-link"
          >
            View on Stellar Expert
          </a>
          <a
            href={tx.horizonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="receipt-link"
          >
            View on Horizon API
          </a>
        </div>

        <div className="receipt-actions no-print">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
          >
            Print Receipt
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportJson}
          >
            Export JSON
          </button>
          <Link to="/transactions" className="btn btn-secondary">
            View All Transactions
          </Link>
        </div>
      </div>
    </div>
  );
}
