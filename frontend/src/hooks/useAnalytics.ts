import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { emitAnalytics, subscribeToAnalytics } from "../lib/analytics";
import type { FunnelStage } from "../lib/analytics";

export function useAnalytics() {
  const track = useCallback(
    (stage: FunnelStage, properties?: Record<string, string | number | boolean | null>) => {
      emitAnalytics(stage, properties);
    },
    [],
  );
  return { track };
}

export function usePageViewTracking() {
  const location = useLocation();
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      emitAnalytics("page_view", { path: location.pathname });
      prevPath.current = location.pathname;
    }
  }, [location.pathname]);
}

export function useWalletAnalytics() {
  const track = useCallback((connected: boolean, address?: string) => {
    if (connected) {
      emitAnalytics("wallet_connect_success", { address: address ?? null });
    } else {
      emitAnalytics("wallet_disconnect");
    }
  }, []);
  return { trackWallet: track };
}

export function useVaultAnalytics() {
  const trackDeposit = useCallback((status: "initiated" | "completed" | "failed", amount?: number) => {
    const stage = `deposit_${status}` as FunnelStage;
    emitAnalytics(stage, amount != null ? { amount } : undefined);
  }, []);

  const trackWithdrawal = useCallback((status: "initiated" | "completed" | "failed", amount?: number) => {
    const stage = `withdrawal_${status}` as FunnelStage;
    emitAnalytics(stage, amount != null ? { amount } : undefined);
  }, []);

  const trackError = useCallback((error: Error, context?: string) => {
    emitAnalytics("error", { message: error.message, context: context ?? null });
  }, []);

  return { trackDeposit, trackWithdrawal, trackError };
}

export { subscribeToAnalytics };
export type { FunnelStage };
