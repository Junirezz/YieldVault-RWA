import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  InAppNotification,
  WithdrawalReadyEventDetail,
} from "../types/notifications";
import {
  dispatchWithdrawalReady,
  subscribeToWithdrawalReady,
} from "../lib/withdrawalNotificationEvents";
import { useTransactionHistory } from "../hooks/useTransactionData";
import { readVersionedItem, writeVersionedItem } from "../lib/versionedStorage";

const NOTIFICATIONS_STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = "yieldvault_withdrawal_notifications";

interface StoredNotificationsPayload {
  notifications: InAppNotification[];
  seenIds: string[];
}

function getStorageKey(walletAddress?: string | null): string {
  const scope = walletAddress?.trim() ? walletAddress.trim() : "guest";
  return `${STORAGE_KEY_PREFIX}:${scope}`;
}

function loadPersistedState(walletAddress?: string | null): StoredNotificationsPayload {
  const key = getStorageKey(walletAddress);
  const loaded = readVersionedItem<StoredNotificationsPayload>(key, {
    version: NOTIFICATIONS_STORAGE_VERSION,
    parseData: (data) => {
      if (typeof data !== "object" || data === null) return null;
      const d = data as Partial<StoredNotificationsPayload>;
      if (!Array.isArray(d.notifications) || !Array.isArray(d.seenIds)) return null;
      return {
        notifications: d.notifications,
        seenIds: d.seenIds,
      };
    },
    migrateLegacy: () => null,
  });

  return loaded ?? { notifications: [], seenIds: [] };
}

function persistState(walletAddress: string | null | undefined, data: StoredNotificationsPayload): void {
  const key = getStorageKey(walletAddress);
  writeVersionedItem(key, NOTIFICATIONS_STORAGE_VERSION, data);
}

export interface WithdrawalNotificationContextType {
  notifications: InAppNotification[];
  unreadCount: number;
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  markAllAsRead: () => void;
  markAsRead: (id: string) => void;
  clearAll: () => void;
  dismissNotification: (id: string) => void;
  addNotificationFromEvent: (detail: WithdrawalReadyEventDetail) => void;
}

const WithdrawalNotificationContext = createContext<
  WithdrawalNotificationContextType | undefined
>(undefined);

export interface WithdrawalNotificationProviderProps {
  children: React.ReactNode;
  walletAddress?: string | null;
}

export const WithdrawalNotificationProvider: React.FC<
  WithdrawalNotificationProviderProps
> = ({ children, walletAddress = null }) => {
  const [notifications, setNotifications] = useState<InAppNotification[]>(() => {
    return loadPersistedState(walletAddress).notifications;
  });

  const seenIdsRef = useRef<Set<string>>(
    new Set(loadPersistedState(walletAddress).seenIds),
  );

  const [isOpen, setIsOpen] = useState(false);

  // Sync state when walletAddress changes
  useEffect(() => {
    const loaded = loadPersistedState(walletAddress);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifications(loaded.notifications);
    seenIdsRef.current = new Set(loaded.seenIds);
  }, [walletAddress]);

  const saveToStorage = useCallback(
    (updatedNotifs: InAppNotification[]) => {
      persistState(walletAddress, {
        notifications: updatedNotifs,
        seenIds: Array.from(seenIdsRef.current),
      });
    },
    [walletAddress],
  );

  const addNotificationFromEvent = useCallback(
    (detail: WithdrawalReadyEventDetail) => {
      const withdrawalId =
        (detail.withdrawalId && String(detail.withdrawalId)) ||
        (detail.transactionHash && String(detail.transactionHash)) ||
        (detail.txHash && String(detail.txHash)) ||
        (detail.id && String(detail.id));

      if (!withdrawalId) {
        return;
      }

      // Deduplication check: ignore if already seen or already in notifications
      if (seenIdsRef.current.has(withdrawalId)) {
        return;
      }

      setNotifications((prev) => {
        const alreadyExists = prev.some(
          (n) =>
            n.withdrawalId === withdrawalId ||
            (detail.transactionHash && n.transactionHash === detail.transactionHash) ||
            (detail.txHash && n.transactionHash === detail.txHash),
        );
        if (alreadyExists) {
          seenIdsRef.current.add(withdrawalId);
          return prev;
        }

        seenIdsRef.current.add(withdrawalId);

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

        const newNotification: InAppNotification = {
          id: `wn-${withdrawalId}-${Date.now()}`,
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

        const next = [newNotification, ...prev];
        saveToStorage(next);
        return next;
      });
    },
    [saveToStorage],
  );

  // Subscribe to 'withdrawal-ready' event
  useEffect(() => {
    const unsubscribe = subscribeToWithdrawalReady((detail) => {
      addNotificationFromEvent(detail);
    });
    return unsubscribe;
  }, [addNotificationFromEvent]);

  // Watch transaction history to discover completed withdrawals when returning to the app
  const { data: transactions } = useTransactionHistory(walletAddress);
  const initialSyncDoneRef = useRef(false);

  useEffect(() => {
    if (!transactions || !Array.isArray(transactions)) return;

    // Filter completed withdrawals
    const completedWithdrawals = transactions.filter(
      (tx) => tx.type === "withdrawal" && tx.status === "completed",
    );

    // If it's the very first time loading for an empty state with many historical items,
    // mark historical ones as seen to avoid flood, OR if returning with a pending one that completed,
    // alert it.
    for (const tx of completedWithdrawals) {
      const id = tx.transactionHash || tx.id;
      if (id && !seenIdsRef.current.has(id)) {
        // Dispatch the withdrawal-ready event
        dispatchWithdrawalReady({
          id: tx.id,
          withdrawalId: id,
          transactionHash: tx.transactionHash,
          amount: tx.amount,
          asset: tx.asset,
          timestamp: tx.timestamp,
          status: "completed",
        });
      }
    }
    initialSyncDoneRef.current = true;
  }, [transactions]);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const hasUnread = prev.some((n) => !n.read);
      if (!hasUnread) return prev;
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveToStorage(updated);
      return updated;
    });
  }, [saveToStorage]);

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const target = prev.find((n) => n.id === id);
        if (!target || target.read) return prev;
        const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage],
  );

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveToStorage([]);
  }, [saveToStorage]);

  const dismissNotification = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        saveToStorage(updated);
        return updated;
      });
    },
    [saveToStorage],
  );

  // Opening the panel marks items read
  const openPanel = useCallback(() => {
    setIsOpen(true);
    markAllAsRead();
  }, [markAllAsRead]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    setIsOpen((current) => {
      const next = !current;
      if (next) {
        markAllAsRead();
      }
      return next;
    });
  }, [markAllAsRead]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      isOpen,
      openPanel,
      closePanel,
      togglePanel,
      markAllAsRead,
      markAsRead,
      clearAll,
      dismissNotification,
      addNotificationFromEvent,
    }),
    [
      notifications,
      unreadCount,
      isOpen,
      openPanel,
      closePanel,
      togglePanel,
      markAllAsRead,
      markAsRead,
      clearAll,
      dismissNotification,
      addNotificationFromEvent,
    ],
  );

  return (
    <WithdrawalNotificationContext.Provider value={value}>
      {children}
    </WithdrawalNotificationContext.Provider>
  );
};

export function useWithdrawalNotifications(): WithdrawalNotificationContextType {
  const context = useContext(WithdrawalNotificationContext);
  if (!context) {
    throw new Error(
      "useWithdrawalNotifications must be used within a WithdrawalNotificationProvider",
    );
  }
  return context;
}
