import type { WithdrawalReadyEventDetail } from "../types/notifications";

export const WITHDRAWAL_READY_EVENT = "withdrawal-ready";

/**
 * Dispatches a 'withdrawal-ready' event on the global window object.
 */
export function dispatchWithdrawalReady(detail: WithdrawalReadyEventDetail): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent<WithdrawalReadyEventDetail>(WITHDRAWAL_READY_EVENT, {
    detail,
  });
  window.dispatchEvent(event);
}

/**
 * Subscribes to the 'withdrawal-ready' event on window.
 * Returns an unsubscription function.
 */
export function subscribeToWithdrawalReady(
  callback: (detail: WithdrawalReadyEventDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<WithdrawalReadyEventDetail>;
    if (customEvent.detail) {
      callback(customEvent.detail);
    }
  };
  window.addEventListener(WITHDRAWAL_READY_EVENT, handler);
  return () => window.removeEventListener(WITHDRAWAL_READY_EVENT, handler);
}
