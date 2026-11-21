/**
 * @file publicConfig.ts
 * Non-secret public runtime configuration served by `GET /config` (Issue #1722).
 *
 * Only allow-listed, non-sensitive values are assembled here. Secrets,
 * credentials and internal service URLs (DATABASE_URL, SOROBAN_RPC_URL,
 * REDIS_URL, JWT_SECRET, ADMIN_ACTION_RECEIPT_SECRET, VAULT_CONTRACT_ID) are
 * never read, let alone returned.
 */

import { PublicConfigSchema, type PublicConfig } from '@yieldvault/api-schemas';
import { env } from './config/env';
import { featureFlags } from './featureFlags';
import { getMaintenanceModeState } from './maintenanceMode';

/**
 * Builds the `GET /config` payload from live runtime state and validates it
 * against the shared contract, so the backend response and the frontend schema
 * cannot drift apart.
 */
export function buildPublicConfig(): PublicConfig {
  return PublicConfigSchema.parse({
    environment: env.NODE_ENV,
    features: featureFlags.getPublicFlags(),
    maintenanceMode: { enabled: getMaintenanceModeState().enabled },
  });
}
