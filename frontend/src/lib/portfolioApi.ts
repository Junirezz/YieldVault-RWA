import { createApiClient } from "./api";

export interface PortfolioHolding {
  id: string;
  asset: string;
  vaultName: string;
  symbol: string;
  shares: number;
  apy: number;
  valueUsd: number;
  unrealizedGainUsd: number;
  issuer: string;
  status: "active" | "pending";
}

const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  headers: {
    Accept: "application/json",
  },
});

export async function getPortfolioHoldings() {
  return apiClient.get<PortfolioHolding[]>("/mock-api/portfolio-holdings.json");
}
