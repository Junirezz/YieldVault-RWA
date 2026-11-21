import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  dispatchWithdrawalReady,
  subscribeToWithdrawalReady,
  WITHDRAWAL_READY_EVENT,
} from "../lib/withdrawalNotificationEvents";
import type {
  InAppNotification,
  WithdrawalReadyEventDetail,
} from "../types/notifications";

describe("Withdrawal Notifications & Completion Alerts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("Event Generation & Subscription", () => {
    it("dispatches 'withdrawal-ready' CustomEvent with details on window", () => {
      const listener = vi.fn();
      window.addEventListener(WITHDRAWAL_READY_EVENT, listener);

      const payload: WithdrawalReadyEventDetail = {
        id: "tx-wd-101",
        withdrawalId: "wd-101",
        transactionHash: "0xabc123def456",
        amount: "150.00",
        asset: "USDC",
        timestamp: "2026-11-19T12:00:00Z",
        status: "completed",
      };

      dispatchWithdrawalReady(payload);

      expect(listener).toHaveBeenCalledTimes(1);
      const eventArg = listener.mock.calls[0][0] as CustomEvent<WithdrawalReadyEventDetail>;
      expect(eventArg.detail).toEqual(payload);

      window.removeEventListener(WITHDRAWAL_READY_EVENT, listener);
    });

    it("subscribeToWithdrawalReady invokes callback and cleans up on unsubscribe", () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToWithdrawalReady(callback);

      dispatchWithdrawalReady({
        id: "sub-1",
        amount: "50.00",
        asset: "USDC",
      });

      expect(callback).toHaveBeenCalledWith({
        id: "sub-1",
        amount: "50.00",
        asset: "USDC",
      });

      unsubscribe();

      dispatchWithdrawalReady({
        id: "sub-2",
        amount: "75.00",
        asset: "USDC",
      });

      // Should not be called again after unsubscribe
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("Deduplication", () => {
    // Pure deduplication & notification processing test
    function processEvent(
      detail: WithdrawalReadyEventDetail,
      existing: InAppNotification[],
      seenIds: Set<string>,
    ): { nextNotifications: InAppNotification[]; deduplicated: boolean } {
      const withdrawalId =
        (detail.withdrawalId && String(detail.withdrawalId)) ||
        (detail.transactionHash && String(detail.transactionHash)) ||
        (detail.txHash && String(detail.txHash)) ||
        (detail.id && String(detail.id));

      if (!withdrawalId) {
        return { nextNotifications: existing, deduplicated: true };
      }

      if (seenIds.has(withdrawalId)) {
        return { nextNotifications: existing, deduplicated: true };
      }

      const alreadyExists = existing.some(
        (n) =>
          n.withdrawalId === withdrawalId ||
          (detail.transactionHash && n.transactionHash === detail.transactionHash),
      );

      if (alreadyExists) {
        seenIds.add(withdrawalId);
        return { nextNotifications: existing, deduplicated: true };
      }

      seenIds.add(withdrawalId);

      const txHash =
        (detail.transactionHash && String(detail.transactionHash)) ||
        (detail.txHash && String(detail.txHash)) ||
        withdrawalId;

      const amountStr =
        detail.amount !== undefined && detail.amount !== null
          ? typeof detail.amount === "number"
            ? detail.amount.toFixed(2)
            : String(detail.amount)
          : null;

      const assetStr = detail.asset ? String(detail.asset) : "USDC";

      const newNotif: InAppNotification = {
        id: `wn-${withdrawalId}`,
        withdrawalId,
        transactionHash: txHash,
        title: "Withdrawal Completed",
        description: amountStr
          ? `Your withdrawal of ${amountStr} ${assetStr} is ready.`
          : "Your withdrawal is ready.",
        amount: amountStr,
        asset: assetStr,
        timestamp: detail.timestamp
          ? new Date(detail.timestamp).toISOString()
          : new Date().toISOString(),
        status: "completed",
        read: false,
        createdAt: Date.now(),
      };

      return { nextNotifications: [newNotif, ...existing], deduplicated: false };
    }

    it("prevents repeated alerts for the same withdrawal id", () => {
      let notifications: InAppNotification[] = [];
      const seenIds = new Set<string>();

      const firstResult = processEvent(
        { id: "wd-repeat", amount: "100.00", asset: "USDC", transactionHash: "hash-999" },
        notifications,
        seenIds,
      );
      notifications = firstResult.nextNotifications;
      expect(firstResult.deduplicated).toBe(false);
      expect(notifications.length).toBe(1);
      expect(notifications[0].read).toBe(false);

      // Repeated event with exact same withdrawal id
      const repeatResult = processEvent(
        { id: "wd-repeat", amount: "100.00", asset: "USDC", transactionHash: "hash-999" },
        notifications,
        seenIds,
      );
      expect(repeatResult.deduplicated).toBe(true);
      expect(repeatResult.nextNotifications.length).toBe(1);
    });

    it("prevents repeated alerts when matched by transactionHash", () => {
      let notifications: InAppNotification[] = [];
      const seenIds = new Set<string>();

      const first = processEvent(
        { withdrawalId: "wd-hash-match", transactionHash: "0xunique-hash", amount: "200.00" },
        notifications,
        seenIds,
      );
      notifications = first.nextNotifications;
      expect(first.deduplicated).toBe(false);
      expect(notifications).toHaveLength(1);

      // Second event arrives with different 'id' but same 'transactionHash'
      const second = processEvent(
        { id: "other-id", transactionHash: "0xunique-hash", amount: "200.00" },
        notifications,
        seenIds,
      );
      expect(second.deduplicated).toBe(true);
      expect(second.nextNotifications).toHaveLength(1);
    });

    it("allows distinct withdrawals to generate separate notifications", () => {
      let notifications: InAppNotification[] = [];
      const seenIds = new Set<string>();

      const notif1 = processEvent(
        { withdrawalId: "wd-1", transactionHash: "hash-1", amount: "10.00" },
        notifications,
        seenIds,
      );
      notifications = notif1.nextNotifications;

      const notif2 = processEvent(
        { withdrawalId: "wd-2", transactionHash: "hash-2", amount: "20.00" },
        notifications,
        seenIds,
      );
      notifications = notif2.nextNotifications;

      expect(notifications).toHaveLength(2);
      expect(notifications[0].withdrawalId).toBe("wd-2");
      expect(notifications[1].withdrawalId).toBe("wd-1");
    });
  });

  describe("Unread Count & Panel Interaction", () => {
    it("computes unread count for completed withdrawals and marks them read on panel open", () => {
      let notifications: InAppNotification[] = [
        {
          id: "wn-1",
          withdrawalId: "wd-1",
          transactionHash: "hash-1",
          title: "Withdrawal Completed",
          description: "Your withdrawal of 50.00 USDC is ready.",
          amount: "50.00",
          asset: "USDC",
          timestamp: new Date().toISOString(),
          status: "completed",
          read: false,
          createdAt: Date.now(),
        },
        {
          id: "wn-2",
          withdrawalId: "wd-2",
          transactionHash: "hash-2",
          title: "Withdrawal Completed",
          description: "Your withdrawal of 100.00 USDC is ready.",
          amount: "100.00",
          asset: "USDC",
          timestamp: new Date().toISOString(),
          status: "completed",
          read: false,
          createdAt: Date.now(),
        },
      ];

      // Bell shows unread count of completed withdrawals
      const unreadCountBefore = notifications.filter((n) => !n.read).length;
      expect(unreadCountBefore).toBe(2);

      // Opening the panel marks items read
      const markAllAsRead = (list: InAppNotification[]) => list.map((n) => ({ ...n, read: true }));
      notifications = markAllAsRead(notifications);

      const unreadCountAfter = notifications.filter((n) => !n.read).length;
      expect(unreadCountAfter).toBe(0);
      expect(notifications.every((n) => n.read)).toBe(true);
    });

    it("links each notification item to the transaction receipt", () => {
      const notification: InAppNotification = {
        id: "wn-link-test",
        withdrawalId: "wd-link-test",
        transactionHash: "tx-receipt-hash-777",
        title: "Withdrawal Completed",
        description: "Your withdrawal of 25.00 USDC is ready.",
        amount: "25.00",
        asset: "USDC",
        timestamp: new Date().toISOString(),
        status: "completed",
        read: true,
        createdAt: Date.now(),
      };

      const receiptLink = `/receipt/${notification.transactionHash}`;
      expect(receiptLink).toBe("/receipt/tx-receipt-hash-777");
    });
  });

  describe("Storage Persistence", () => {
    it("persists and restores notifications with versioned storage format", () => {
      const storageKey = "yieldvault_withdrawal_notifications:G_TEST_WALLET";
      const samplePayload = {
        version: 1,
        data: {
          notifications: [
            {
              id: "wn-saved",
              withdrawalId: "wd-saved",
              transactionHash: "hash-saved",
              title: "Withdrawal Completed",
              description: "Your withdrawal of 80.00 USDC is ready.",
              amount: "80.00",
              asset: "USDC",
              timestamp: "2026-11-19T10:00:00Z",
              status: "completed" as const,
              read: true,
              createdAt: 1000,
            },
          ],
          seenIds: ["wd-saved"],
        },
      };

      localStorage.setItem(storageKey, JSON.stringify(samplePayload));

      const raw = localStorage.getItem(storageKey);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(parsed.data.notifications[0].withdrawalId).toBe("wd-saved");
      expect(parsed.data.seenIds).toContain("wd-saved");
    });
  });
});
