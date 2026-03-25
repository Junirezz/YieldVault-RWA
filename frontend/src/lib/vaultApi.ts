import { createApiClient } from "./api";

export interface StrategyMetadata {
  id: string;
  name: string;
  issuer: string;
  network: string;
  rpcUrl: string;
  status: "active" | "inactive";
  description: string;
}

export interface VaultSummary {
  tvl: number;
  apy: number;
  participantCount: number;
  monthlyGrowthPct: number;
  strategyStabilityPct: number;
  assetLabel: string;
  exchangeRate: number;
  networkFeeEstimate: string;
  updatedAt: string;
  strategy: StrategyMetadata;
}

const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  headers: {
    Accept: "application/json",
  },
});

export async function getVaultSummary() {
  return apiClient.get<VaultSummary>("/mock-api/vault-summary.json");
}
