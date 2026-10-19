import { useState, useEffect, useCallback, useRef } from "react";
import type { TxTimelineStatus } from "../components/TransactionTimeline";
import { networkConfig } from "../config/network";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // ~2 minutes

interface HorizonTxResponse {
  hash: string;
  successful: boolean;
}

interface UseTransactionTimelineOptions {
  /** Stellar transaction hash to track. Pass null/undefined to disable. */
  txHash: string | null | undefined;
  /** Called when the transaction reaches a terminal state. */
  onFinalized?: (success: boolean) => void;
}

interface UseTransactionTimelineResult {
  status: TxTimelineStatus;
  elapsedSeconds: number;
  errorMessage: string | undefined;
  /** Manually reset to re-track a new transaction */
  reset: () => void;
}

async function fetchTxStatus(hash: string): Promise<"finalized" | "failed" | "pending"> {
  const res = await fetch(`${networkConfig.horizonUrl}/transactions/${hash}`);
  if (res.status === 404) return "pending";
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  const data = (await res.json()) as HorizonTxResponse;
  return data.successful ? "finalized" : "failed";
}

export function useTransactionTimeline({
  txHash,
  onFinalized,
}: UseTransactionTimelineOptions): UseTransactionTimelineResult {
  const [status, setStatus] = useState<TxTimelineStatus>("pending");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const attemptsRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const onFinalizedRef = useRef(onFinalized);
  const isTerminalRef = useRef(false);

  useEffect(() => {
    onFinalizedRef.current = onFinalized;
  }, [onFinalized]);

  const reset = useCallback(() => {
    setStatus("pending");
    setElapsedSeconds(0);
    setErrorMessage(undefined);
    attemptsRef.current = 0;
    startTimeRef.current = Date.now();
    isTerminalRef.current = false;
  }, []);

  // Elapsed seconds ticker
  useEffect(() => {
    if (!txHash || isTerminalRef.current) return;

    startTimeRef.current = Date.now();
    const ticker = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(ticker);
  }, [txHash]);

  // Polling loop
  useEffect(() => {
    if (!txHash) return;

    isTerminalRef.current = false;
    attemptsRef.current = 0;
    queueMicrotask(() => {
      setStatus("pending");
      setErrorMessage(undefined);
    });

    let timeoutId: ReturnType<typeof setTimeout>;

    async function poll() {
      if (isTerminalRef.current) return;

      attemptsRef.current += 1;

      // Transition to "confirming" after first attempt
      if (attemptsRef.current === 2) {
        setStatus("confirming");
      }

      if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
        isTerminalRef.current = true;
        setStatus("failed");
        setErrorMessage("Transaction timed out. It may still confirm on-chain.");
        onFinalizedRef.current?.(false);
        return;
      }

      try {
        const result = await fetchTxStatus(txHash as string);

        if (result === "finalized") {
          isTerminalRef.current = true;
          setStatus("finalized");
          onFinalizedRef.current?.(true);
          return;
        }

        if (result === "failed") {
          isTerminalRef.current = true;
          setStatus("failed");
          setErrorMessage("Transaction was rejected by the network.");
          onFinalizedRef.current?.(false);
          return;
        }

        // Still pending — schedule next poll
        timeoutId = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      } catch {
        // Network error — keep polling
        timeoutId = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      }
    }

    void poll();

    return () => {
      clearTimeout(timeoutId);
      isTerminalRef.current = true;
    };
  }, [txHash]);

  return { status, elapsedSeconds, errorMessage, reset };
}
