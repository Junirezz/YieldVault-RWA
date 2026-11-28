import { z } from "zod";

/**
 * Feature-flag names that are safe to disclose to unauthenticated clients via
 * the backend `GET /config` endpoint (Issue #1722).
 *
 * Anything not listed here is never surfaced, so internal, experimental or
 * security-relevant flags cannot leak through the public config endpoint.
 */
export const PUBLIC_FEATURE_FLAG_KEYS = [
  "deposit-v2",
  "strategy-selection",
  "analytics-page",
] as const;

export type PublicFeatureFlagKey = (typeof PUBLIC_FEATURE_FLAG_KEYS)[number];

/**
 * `GET /config` response: non-secret runtime feature flags plus minimal public
 * configuration.
 *
 * `features` is a partial record — a key is present only when the server
 * actually configures that flag, so consumers can distinguish "not configured"
 * (key absent) from "explicitly disabled" (`false`). Per-wallet allowlists,
 * secrets, credentials and internal service URLs are never included.
 */
export const PublicConfigSchema = z
  .object({
    environment: z.enum(["development", "production", "test"]),
    features: z
      .object({
        "deposit-v2": z.boolean().optional(),
        "strategy-selection": z.boolean().optional(),
        "analytics-page": z.boolean().optional(),
      })
      .strict(),
    maintenanceMode: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();

export type PublicConfig = z.infer<typeof PublicConfigSchema>;
