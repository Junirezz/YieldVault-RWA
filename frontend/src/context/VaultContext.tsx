import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { subscribeToApiTelemetry, normalizeApiError } from "../lib/api";
import type { ApiError } from "../lib/api";
import type { VaultSummary } from "../lib/vaultApi";
import { networkConfig } from "../config/network";
import { useVaultSummary, useVaultHistory } from "../hooks/useVaultData";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { formatCurrency } from "../lib/formatters";

interface VaultContextType {
  summary: VaultSummary;
  tvl: number;
  depositCap: number;
  utilization: number;
  isCapWarning: boolean;
  isCapReached: boolean;
  apy: number;
  formattedTvl: string;
  formattedApy: string;
  lastUpdate: Date;
  isLoading: boolean;
  /**
   * True when the vault summary query finished without data (e.g. the API
   * failed). Consumers must not present `summary` as live while this is set —
   * it is only a placeholder to keep dependents rendering.
   */
  summaryUnavailable: boolean;
  error: ApiError | null;
  contractPaused: boolean;
  strategySwitchCooldownRemaining: number;
  strategySwitchCooldownTotal: number;
  refresh: () => Promise<void>;
}

const DEFAULT_SUMMARY: VaultSummary = {
  tvl: 12450800,
  depositCap: 15000000,
  apy: 8.45,
  participantCount: 1248,
  monthlyGrowthPct: 12.5,
  strategyStabilityPct: 99.9,
  assetLabel: "Sovereign Debt",
  exchangeRate: 1.084,
  networkFeeEstimate: "~0.00001 XLM",
  updatedAt: "2026-03-25T10:00:00.000Z",
  contractPaused: false,
  strategy: {
    id: "stellar-benji",
    name: "Franklin BENJI Connector",
    issuer: "Franklin Templeton",
    network: "Stellar",
    rpcUrl: networkConfig.rpcUrl,
    status: "active",
    description:
      "Connector strategy that routes vault yield updates from BENJI-issued tokenized money market exposure on Stellar.",
  },
};

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isOnline } = useNetworkStatus();
  const { data, isLoading: isSummaryLoading, error: summaryError, refetch: refetchSummary } = useVaultSummary(isOnline);
  const { data: historyData, isLoading: isHistoryLoading, error: historyError, refetch: refetchHistory } = useVaultHistory();

  const isLoading = isSummaryLoading || isHistoryLoading;
  const queryError = summaryError || historyError;
  const summaryUnavailable = !isSummaryLoading && !data && Boolean(summaryError);

  const summary: VaultSummary = data
    ? {
        ...data,
        strategy: {
          ...data.strategy,
          rpcUrl: networkConfig.rpcUrl,
        },
      }
    : DEFAULT_SUMMARY;

  // Normalize any query error so consumers can render an API status banner.
  const error: ApiError | null = queryError ? normalizeApiError(queryError) : null;

  const lastUpdate = useMemo(() => new Date(summary.updatedAt), [summary.updatedAt]);

  const utilization = summary.depositCap > 0 ? summary.tvl / summary.depositCap : 0;
  const isCapWarning = utilization > 0.9 && utilization < 1.0;
  const isCapReached = utilization >= 1.0;

  useEffect(() => {
    const unsubscribe = subscribeToApiTelemetry((event) => {
      if (event.type === "error") {
        console.error("[api]", event.error);
      }
    });

    return unsubscribe;
  }, []);

  const formattedTvl = formatCurrency(summary.tvl, "USD", 0);

  const calculateApy = () => {
    if (!historyData || historyData.length < 2) return null;
    const start = historyData[0];
    const end = historyData[historyData.length - 1];
    
    const startDate = new Date(start.date).getTime();
    const endDate = new Date(end.date).getTime();
    const days = (endDate - startDate) / (1000 * 60 * 60 * 24);
    
    if (days <= 0) return null;
    return ((end.value / start.value) ** (365 / days) - 1) * 100;
  };

  const calculatedApy = calculateApy();
  const currentApy = calculatedApy !== null ? calculatedApy : summary.apy;
  const formattedApy = calculatedApy !== null || data ? `${currentApy.toFixed(2)}%` : "N/A";

  // Strategy switch cooldown tracking
  const [strategySwitchCooldownRemaining, setStrategySwitchCooldownRemaining] = useState(0);
  const [strategySwitchCooldownTotal, setStrategySwitchCooldownTotal] = useState(0);

  // Poll cooldown from backend on interval
  const fetchCooldown = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/vault/strategy/cooldown");
      if (res.ok) {
        const data = await res.json();
        setStrategySwitchCooldownRemaining(data.remaining ?? 0);
        setStrategySwitchCooldownTotal(data.total ?? 0);
      }
    } catch {
      // Silently ignore — cooldown display is non-critical
    }
  }, []);

  useEffect(() => {
    const initialId = window.setTimeout(() => void fetchCooldown(), 0);
    const interval = setInterval(() => void fetchCooldown(), 10000);
    return () => {
      window.clearTimeout(initialId);
      clearInterval(interval);
    };
  }, [fetchCooldown]);

  const refresh = async () => {
    await Promise.all([refetchSummary(), refetchHistory(), fetchCooldown()]);
  };

  return (
    <VaultContext.Provider
      value={{
        summary,
        tvl: summary.tvl,
        depositCap: summary.depositCap,
        utilization,
        isCapWarning,
        isCapReached,
        apy: currentApy,
        formattedTvl,
        formattedApy,
        lastUpdate,
        isLoading,
        summaryUnavailable,
        error,
        contractPaused: summary.contractPaused,
        strategySwitchCooldownRemaining,
        strategySwitchCooldownTotal,
        refresh,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
};
