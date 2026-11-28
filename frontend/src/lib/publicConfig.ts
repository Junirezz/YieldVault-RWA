/**
 * @file publicConfig.ts
 * Typed client for the backend's public runtime configuration endpoint
 * (Issue #1722).
 *
 * `GET /config` returns only allow-listed, non-secret values, so the frontend
 * can discover which runtime features are enabled at startup instead of
 * hardcoding build-time assumptions. The response is validated against the
 * shared `PublicConfigSchema` before it is used.
 */

import { apiClient } from "./apiClient";
import { validate, PublicConfigSchema, type PublicConfig } from "./api";

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const data = await apiClient.get<unknown>("/config", { retry: false });
  return validate(PublicConfigSchema, data, "PublicConfig");
}
