import { useState, useEffect, useCallback, useRef } from "react";
import { isConnected } from "@stellar/freighter-api";

export type HeartbeatState = "healthy" | "degraded" | "unhealthy";

export interface WalletHeartbeat {
  state: HeartbeatState;
  latencyMs: number | null;
  lastChecked: Date | null;
  consecutiveFailures: number;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const DEGRADED_LATENCY_THRESHOLD_MS = 2_000;
const UNHEALTHY_CONSECUTIVE_FAILURES = 3;

const INITIAL: WalletHeartbeat = {
  state: "healthy",
  latencyMs: null,
  lastChecked: null,
  consecutiveFailures: 0,
};

export function useWalletHeartbeat(
  walletAddress: string | null,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): WalletHeartbeat & { refetch: () => void } {
  const [heartbeat, setHeartbeat] = useState<WalletHeartbeat>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (!walletAddress) {
      setHeartbeat(INITIAL);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const start = performance.now();

    try {
      const result = await isConnected();
      const elapsed = performance.now() - start;

      if (result?.isConnected) {
        setHeartbeat(() => ({
          state: elapsed > DEGRADED_LATENCY_THRESHOLD_MS ? "degraded" : "healthy",
          latencyMs: Math.round(elapsed),
          lastChecked: new Date(),
          consecutiveFailures: 0,
        }));
      } else {
        setHeartbeat((prev) => {
          const failures = prev.consecutiveFailures + 1;
          return {
            state: failures >= UNHEALTHY_CONSECUTIVE_FAILURES ? "unhealthy" : "degraded",
            latencyMs: Math.round(elapsed),
            lastChecked: new Date(),
            consecutiveFailures: failures,
          };
        });
      }
    } catch {
      setHeartbeat((prev) => {
        const failures = prev.consecutiveFailures + 1;
        return {
          state: failures >= UNHEALTHY_CONSECUTIVE_FAILURES ? "unhealthy" : "degraded",
          latencyMs: null,
          lastChecked: new Date(),
          consecutiveFailures: failures,
        };
      });
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear local heartbeat when wallet disconnects
      // Reset heartbeat when the session address is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on wallet disconnect
      setHeartbeat(INITIAL);
      return;
    }

    void check();
    const intervalId = window.setInterval(() => void check(), intervalMs);

    return () => {
      window.clearInterval(intervalId);
      abortRef.current?.abort();
    };
  }, [check, intervalMs, walletAddress]);

  return { ...heartbeat, refetch: check };
}
