import { useState, useCallback, useEffect, useRef } from "react";

export type TransactionState = "idle" | "submitting" | "pending" | "success" | "failed" | "cancelled";

export interface PendingTransaction {
  id: string;
  type: "deposit" | "withdraw";
  amount: number;
  submittedAt: number;
  state: TransactionState;
  txHash?: string;
  error?: string;
}

const STALE_THRESHOLD_MS = 60_000;

interface UseTransactionRetryOptions {
  maxRetries?: number;
  staleThresholdMs?: number;
}

interface UseTransactionRetryReturn {
  pendingTransactions: PendingTransaction[];
  addPendingTransaction: (tx: Omit<PendingTransaction, "id" | "submittedAt" | "state">) => string;
  markSuccess: (id: string, txHash: string) => void;
  markFailed: (id: string, error: string) => void;
  markCancelled: (id: string) => void;
  retryTransaction: (id: string) => string | null;
  refreshStatus: (id: string) => void;
  getRetryCount: (id: string) => number;
  isStale: (id: string) => boolean;
  dismissTransaction: (id: string) => void;
}

export function useTransactionRetry(
  options: UseTransactionRetryOptions = {}
): UseTransactionRetryReturn {
  const { staleThresholdMs = STALE_THRESHOLD_MS } = options;
  const [transactions, setTransactions] = useState<Map<string, PendingTransaction>>(new Map());
  const retryCounts = useRef<Map<string, number>>(new Map());

  const addPendingTransaction = useCallback(
    (tx: Omit<PendingTransaction, "id" | "submittedAt" | "state">): string => {
      const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const newTx: PendingTransaction = {
        ...tx,
        id,
        submittedAt: Date.now(),
        state: "pending",
      };
      setTransactions((prev) => new Map(prev).set(id, newTx));
      retryCounts.current.set(id, 0);
      return id;
    },
    []
  );

  const markSuccess = useCallback((id: string, txHash: string) => {
    setTransactions((prev) => {
      const next = new Map(prev);
      const tx = next.get(id);
      if (tx) next.set(id, { ...tx, state: "success", txHash });
      return next;
    });
  }, []);

  const markFailed = useCallback((id: string, error: string) => {
    setTransactions((prev) => {
      const next = new Map(prev);
      const tx = next.get(id);
      if (tx) next.set(id, { ...tx, state: "failed", error });
      return next;
    });
  }, []);

  const markCancelled = useCallback((id: string) => {
    setTransactions((prev) => {
      const next = new Map(prev);
      const tx = next.get(id);
      if (tx) next.set(id, { ...tx, state: "cancelled" });
      return next;
    });
  }, []);

  const getRetryCount = useCallback((id: string): number => {
    return retryCounts.current.get(id) ?? 0;
  }, []);

  const retryTransaction = useCallback((id: string): string | null => {
    const tx = transactions.get(id);
    if (!tx || tx.state === "cancelled") return null;

    const currentCount = retryCounts.current.get(id) ?? 0;
    retryCounts.current.set(id, currentCount + 1);

    const newId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const retriedTx: PendingTransaction = {
      id: newId,
      type: tx.type,
      amount: tx.amount,
      submittedAt: Date.now(),
      state: "pending",
    };
    setTransactions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      next.set(newId, retriedTx);
      return next;
    });
    return newId;
  }, [transactions]);

  const refreshStatus = useCallback(() => {
    // In a real implementation this would poll Horizon for tx status
  }, []);

  const isStale = useCallback(
    (id: string): boolean => {
      const tx = transactions.get(id);
      if (!tx || tx.state !== "pending") return false;
      return Date.now() - tx.submittedAt > staleThresholdMs;
    },
    [transactions, staleThresholdMs]
  );

  const dismissTransaction = useCallback((id: string) => {
    setTransactions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    retryCounts.current.delete(id);
  }, []);

  // Cleanup old transactions
  useEffect(() => {
    const interval = setInterval(() => {
      setTransactions((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        let changed = false;
        for (const [id, tx] of next.entries()) {
          if (tx.state === "success" && now - tx.submittedAt > 300_000) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return {
    pendingTransactions: Array.from(transactions.values()),
    addPendingTransaction,
    markSuccess,
    markFailed,
    markCancelled,
    retryTransaction,
    refreshStatus,
    getRetryCount,
    isStale,
    dismissTransaction,
  };
}
