export type FunnelStage =
  | "page_view"
  | "wallet_connect_initiated"
  | "wallet_connect_success"
  | "wallet_connect_failed"
  | "wallet_disconnect"
  | "deposit_initiated"
  | "deposit_completed"
  | "deposit_failed"
  | "withdrawal_initiated"
  | "withdrawal_completed"
  | "withdrawal_failed"
  | "vault_selected"
  | "error";

export interface AnalyticsEvent {
  stage: FunnelStage;
  timestamp: number;
  properties?: Record<string, string | number | boolean | null>;
}

type AnalyticsListener = (event: AnalyticsEvent) => void;
const listeners = new Set<AnalyticsListener>();

export function subscribeToAnalytics(fn: AnalyticsListener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitAnalytics(
  stage: FunnelStage,
  properties?: Record<string, string | number | boolean | null>,
) {
  if (typeof window === "undefined") return;
  const event: AnalyticsEvent = { stage, timestamp: Date.now(), properties };
  if (import.meta.env.DEV) {
    console.info(`[analytics] ${stage}`, properties ?? "");
  }
  listeners.forEach((fn) => fn(event));
}
