import type { ToastItem } from "../context/ToastContext";

/**
 * Deduplication keys for toast notifications.
 *
 * Transaction notifications are keyed by hash only (not by status) so a poll
 * or event stream reporting the same hash repeatedly cannot stack toasts. A
 * status transition updates the existing toast in place instead of creating a
 * second one. Other toasts keep the previous title/description/variant key.
 */
export interface ToastDedupeFields {
  dedupeKey?: string;
  title: string;
  description?: string;
  variant?: string;
  transactionHash?: string;
}

export function getToastDedupeKey(options: ToastDedupeFields): string {
  if (options.transactionHash) {
    return `transaction:${options.transactionHash.trim().toLowerCase()}`;
  }
  if (options.dedupeKey) {
    return `key:${options.dedupeKey}`;
  }
  return `content:${options.variant || "info"}|${options.title}|${options.description || ""}`;
}

/**
 * Last-write-wins dedupe applied immediately before rendering, as a safety net
 * for toasts coming from multiple polling/event sources. Unrelated toasts are
 * left untouched and the original ordering is preserved.
 */
export function dedupeToastsForDisplay(toasts: ToastItem[]): ToastItem[] {
  const indices = new Map<string, number>();
  const result: ToastItem[] = [];

  for (const toast of toasts) {
    const key = getToastDedupeKey({ ...toast });
    const existingIndex = indices.get(key);
    if (existingIndex === undefined) {
      indices.set(key, result.length);
      result.push(toast);
    } else {
      result[existingIndex] = toast;
    }
  }

  return result;
}
