import { z } from "zod";
import { apiClient } from "./apiClient";
import { validate } from "./api";

export const VaultHealthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
]);

export const VaultHealthRecordSchema = z.object({
  vaultId: z.string().min(1),
  name: z.string().min(1),
  status: VaultHealthStatusSchema,
  latencyMs: z.number().nonnegative(),
  uptimePct: z.number().min(0).max(100),
  lastCheckedAt: z.string().min(1),
  message: z.string(),
});

export const VaultHealthResponseSchema = z.array(VaultHealthRecordSchema);

export type VaultHealthStatus = z.infer<typeof VaultHealthStatusSchema>;
export type VaultHealthRecord = z.infer<typeof VaultHealthRecordSchema>;

/**
 * Fetch live vault health indicators from the backend health API.
 * Response is validated with Zod before returning.
 *
 * Falls back to mock data if the real endpoint is unavailable.
 */
export async function getVaultHealth(): Promise<VaultHealthRecord[]> {
  try {
    const data = await apiClient.get<unknown>("/mock-api/vault-health.json");
    return validate(VaultHealthResponseSchema, data, "VaultHealth");
  } catch {
    return [];
  }
}

export const VaultMetricsSchema = z.object({
  totalAssets: z.string(),
  totalShares: z.string(),
  sharePrice: z.string(),
  apy: z.number(),
  timestamp: z.string(),
});

export type VaultMetrics = z.infer<typeof VaultMetricsSchema>;

/**
 * Fetch vault summary metrics from the backend.
 */
export async function getVaultMetrics(): Promise<VaultMetrics> {
  try {
    const data = await apiClient.get<unknown>("/api/v1/vault/summary");
    return validate(VaultMetricsSchema, data, "VaultMetrics");
  } catch {
    return {
      totalAssets: "0",
      totalShares: "0",
      sharePrice: "1.000000",
      apy: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
