import React from "react";
import { AlertCircle, RefreshCw, X, Clock, Check } from "./icons";
import type { PendingTransaction, TransactionState } from "../hooks/useTransactionRetry";

interface TransactionRetryPanelProps {
  transactions: PendingTransaction[];
  onRetry: (id: string) => void;
  onRefresh: (id: string) => void;
  onDismiss: (id: string) => void;
  isStale: (id: string) => boolean;
  getRetryCount: (id: string) => number;
}

const stateConfig: Record<
  TransactionState,
  { label: string; color: string; icon: React.ReactNode }
> = {
  idle: { label: "Idle", color: "var(--text-secondary)", icon: null },
  submitting: {
    label: "Submitting...",
    color: "var(--accent-cyan)",
    icon: null,
  },
  pending: {
    label: "Pending",
    color: "var(--text-warning)",
    icon: <Clock size={14} />,
  },
  success: {
    label: "Confirmed",
    color: "var(--text-success)",
    icon: <Check size={14} />,
  },
  failed: {
    label: "Failed",
    color: "var(--text-error)",
    icon: <AlertCircle size={14} />,
  },
  cancelled: {
    label: "Cancelled",
    color: "var(--text-secondary)",
    icon: <X size={14} />,
  },
};

const TransactionRetryPanel: React.FC<TransactionRetryPanelProps> = ({
  transactions,
  onRetry,
  onRefresh,
  onDismiss,
  isStale,
  getRetryCount,
}) => {
  const visibleTransactions = transactions.filter(
    (tx) => tx.state !== "idle" && tx.state !== "success"
  );

  if (visibleTransactions.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Transaction status"
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: 900,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "360px",
        width: "100%",
      }}
    >
      {visibleTransactions.map((tx) => {
        const config = stateConfig[tx.state];
        const stale = isStale(tx.id);
        const retryCount = getRetryCount(tx.id);
        const timeAgo = Math.floor((Date.now() - tx.submittedAt) / 1000);
        const minutes = Math.floor(timeAgo / 60);
        const seconds = timeAgo % 60;

        return (
          <div
            key={tx.id}
            role="alert"
            aria-live="polite"
            className="glass-panel"
            style={{
              padding: "12px 16px",
              borderLeft: `3px solid ${config.color}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {config.icon}
                <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  {tx.type === "deposit" ? "Deposit" : "Withdraw"} {tx.amount.toFixed(2)} USDC
                </span>
              </div>
              <button
                onClick={() => onDismiss(tx.id)}
                aria-label={`Dismiss ${tx.type} transaction status`}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  padding: "2px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ fontSize: "0.8rem", color: config.color, marginBottom: "8px" }}>
              {config.label}
              {tx.state === "pending" && (
                <span style={{ color: "var(--text-secondary)", marginLeft: "8px" }}>
                  {minutes}m {seconds}s
                </span>
              )}
            </div>

            {stale && tx.state === "pending" && (
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 8px",
                  fontSize: "0.8rem",
                  color: "var(--text-warning)",
                  marginBottom: "8px",
                }}
              >
                Transaction may be stuck. Consider refreshing or retrying.
              </div>
            )}

            {tx.error && (
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 8px",
                  fontSize: "0.8rem",
                  color: "var(--text-error)",
                  marginBottom: "8px",
                }}
              >
                {tx.error}
              </div>
            )}

            <div style={{ display: "flex", gap: "6px" }}>
              {tx.state === "pending" && (
                <button
                  onClick={() => onRefresh(tx.id)}
                  aria-label="Refresh transaction status"
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-glass)",
                    background: "transparent",
                    color: "var(--text-primary)",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>
              )}
              {(tx.state === "failed" || stale) && retryCount < 3 && (
                <button
                  onClick={() => onRetry(tx.id)}
                  aria-label="Retry transaction"
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: "var(--accent-cyan)",
                    color: "var(--bg-main)",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <RefreshCw size={12} />
                  Retry {retryCount > 0 ? `(${retryCount}/3)` : ""}
                </button>
              )}
              {tx.state === "cancelled" && (
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    fontStyle: "italic",
                  }}
                >
                  Transaction was cancelled
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TransactionRetryPanel;
