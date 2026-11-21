import { describe, expect, it } from "vitest";
import { dedupeToastsForDisplay, getToastDedupeKey } from "./toastDedupe";
import type { ToastItem } from "../context/ToastContext";

const TX_HASH = "A".repeat(64);

function toast(id: string, overrides: Partial<ToastItem> = {}): ToastItem {
  return {
    id,
    variant: "info",
    title: "Notice",
    duration: 5000,
    timestamp: 0,
    ...overrides,
  };
}

describe("toast deduplication", () => {
  describe("getToastDedupeKey", () => {
    it("keys transaction notifications by normalized hash only", () => {
      expect(
        getToastDedupeKey({
          title: "Submitted",
          description: "Waiting",
          status: "submitted",
          transactionHash: `  ${TX_HASH}  `,
        }),
      ).toBe(getToastDedupeKey({
        title: "Confirmed",
        description: "Included in a ledger",
        status: "success",
        transactionHash: TX_HASH.toLowerCase(),
      }));
    });

    it("prefers an explicit dedupe key over content for non-transaction toasts", () => {
      expect(getToastDedupeKey({ title: "A", dedupeKey: "save-profile" })).toBe(
        getToastDedupeKey({ title: "B", dedupeKey: "save-profile" }),
      );
    });

    it("keys ordinary toasts by variant, title, and description", () => {
      const key = getToastDedupeKey({ title: "Saved", variant: "success", description: "Done" });
      expect(key).toBe("content:success|Saved|Done");
      expect(getToastDedupeKey({ title: "Saved", variant: "error", description: "Done" })).not.toBe(key);
    });
  });

  describe("dedupeToastsForDisplay", () => {
    it("replaces older transaction updates with the latest one and keeps ordering", () => {
      const submitted = toast("toast-1", {
        title: "Transaction submitted",
        variant: "success",
        transactionHash: TX_HASH,
        status: "submitted",
      });
      const unrelated = toast("toast-2", { title: "Unrelated notice", variant: "info" });
      const confirmed = toast("toast-3", {
        title: "Transaction confirmed",
        variant: "success",
        transactionHash: TX_HASH,
        status: "success",
      });

      expect(dedupeToastsForDisplay([submitted, unrelated, confirmed])).toEqual([
        { ...confirmed },
        unrelated,
      ]);
    });

    it("leaves toasts without duplicate keys untouched", () => {
      const first = toast("toast-1");
      const second = toast("toast-2", { title: "Another notice" });

      expect(dedupeToastsForDisplay([first, second])).toEqual([first, second]);
    });
  });
});
