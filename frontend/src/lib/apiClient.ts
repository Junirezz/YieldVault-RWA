/**
 * Shared API client singleton.
 *
 * The `getCorrelationId` getter starts as a fallback generator and is
 * replaced at runtime by `CorrelationIdSync` once the React context is
 * mounted, so every request automatically carries the current context ID.
 */
import { createApiClient } from "./api";
import { generateCorrelationId } from "./api/correlationInterceptors";

// Mutable getter — replaced by CorrelationIdSync after React mounts.
let _getCorrelationId: () => string = generateCorrelationId;

export function setCorrelationIdGetter(getter: () => string): void {
  _getCorrelationId = getter;
}

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  headers: {
    Accept: "application/json",
  },
  getCorrelationId: () => _getCorrelationId(),
});
