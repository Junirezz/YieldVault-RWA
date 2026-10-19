/**
 * useWalletConnection
 *
 * Encapsulates the full wallet connection state machine, Freighter polling,
 * reconnect prompt logic, and session management.
 *
 * Statuses:
 *   disconnected → connecting → connected | error
 *   error        → retrying  → connected | error
 *
 * Usage:
 *   const wallet = useWalletConnection({ walletAddress, onConnect, onDisconnect });
 *   wallet.status        // "disconnected" | "connecting" | "retrying" | "connected" | "error"
 *   wallet.handleConnect()  // trigger connect
 *   wallet.handleRetry()    // retry after error
 *   wallet.handleDisconnect() // manual disconnect
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  getAddress,
  isAllowed,
  isConnected,
  setAllowed,
} from "@stellar/freighter-api";
import {
  classifyFreighterApiError,
  classifyWalletConnectionError,
  createWalletConnectionError,
  hasWalletConnectionError,
  initialWalletConnectionState,
  isWalletConnecting,
  isWalletRetrying,
  reduceWalletConnection,
  walletErrorI18nKeys,
  type WalletConnectionState,
} from "../lib/walletConnectionState";
import {
  clearLastWalletProvider,
  clearReconnectPromptDismissed,
  clearWalletManualDisconnect,
  getLastWalletProvider,
  isProviderAvailable,
  isReconnectPromptDismissed,
  isWalletManualDisconnectSet,
  setLastWalletProvider,
  setReconnectPromptDismissed,
  setWalletManualDisconnect,
  startWalletSession,
  type WalletProvider,
} from "../lib/walletSession";
import {
  discoverConnectedAddress,
  discoverConnectedAddressWithRetry,
} from "../lib/stellarAccount";
import { useToast } from "../context/ToastContext";
import { useTranslation } from "../i18n";

const IS_AUTOMATED_TEST =
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "test" || process.env.VITEST === "true");

const WALLET_POLL_INTERVAL_MS = IS_AUTOMATED_TEST ? 100 : 10_000;

/** Upper bound for the backoff applied after consecutive polling failures. */
const WALLET_POLL_MAX_INTERVAL_MS = IS_AUTOMATED_TEST ? 1_600 : 60_000;

/** Multiplier applied to the poll interval after each consecutive failure. */
const WALLET_POLL_BACKOFF_FACTOR = 2;

/**
 * Delay before the next wallet poll.
 *
 * Grows exponentially with the number of consecutive failures
 * (base → 2× → 4× …) and is capped, so a Freighter outage does not turn into a
 * hot polling loop. Any successful poll resets the counter to zero.
 */
export function getWalletPollDelay(
  consecutiveFailures: number,
  baseMs: number = WALLET_POLL_INTERVAL_MS,
  maxMs: number = WALLET_POLL_MAX_INTERVAL_MS,
): number {
  if (consecutiveFailures <= 0) return baseMs;
  return Math.min(
    baseMs * WALLET_POLL_BACKOFF_FACTOR ** consecutiveFailures,
    maxMs,
  );
}

export type DisconnectReason = "manual" | "session-expired" | "connection-lost";

export interface UseWalletConnectionOptions {
  /** Currently connected address (controlled from parent / persisted state). */
  walletAddress: string | null;
  /** Called when a new address is successfully connected. */
  onConnect: (address: string) => void;
  /** Called when the wallet is disconnected for any reason. */
  onDisconnect: (reason?: DisconnectReason) => void;
}

export interface UseWalletConnectionResult {
  /** Current machine state, expose the whole object for derived reads. */
  connection: WalletConnectionState;
  /** Convenience shorthand: status string. */
  status: WalletConnectionState["status"];
  /** True while connecting or retrying. */
  isBusy: boolean;
  /** True when in the retrying state specifically. */
  isRetrying: boolean;
  /** True when there is an actionable error. */
  hasError: boolean;
  /** True while doing the initial Freighter session discovery on mount. */
  isFreighterDiscovering: boolean;
  /** Reconnect provider for the "Welcome back" prompt, or null. */
  reconnectProvider: WalletProvider | null;
  /** Dismiss the reconnect prompt without connecting. */
  dismissReconnectPrompt: () => void;
  /** i18n helper: keys for the current error code. */
  errorI18nKeys: { title: string; description: string } | null;
  /** Initiate a fresh connection request. */
  handleConnect: () => Promise<void>;
  /** Retry after an error (distinct from a fresh connect — shows "retrying" status). */
  handleRetry: () => Promise<void>;
  /** Manual user-initiated disconnect. */
  handleDisconnect: () => void;
}

async function isFreighterReachable(): Promise<boolean> {
  try {
    const result = await isConnected();
    return result?.isConnected !== false;
  } catch {
    return false;
  }
}

export function useWalletConnection({
  walletAddress,
  onConnect,
  onDisconnect,
}: UseWalletConnectionOptions): UseWalletConnectionResult {
  const [connection, dispatch] = useReducer(
    reduceWalletConnection,
    initialWalletConnectionState,
  );
  const [isFreighterDiscovering, setIsFreighterDiscovering] = useState(
    () =>
      !IS_AUTOMATED_TEST &&
      typeof window !== "undefined" &&
      !isWalletManualDisconnectSet(),
  );
  const [reconnectProvider, setReconnectProvider] = useState<WalletProvider | null>(null);
  const initialSyncDoneRef = useRef(false);
  const toast = useToast();
  const { t } = useTranslation();

  // --- Align state machine with controlled address from parent ----------------

  useEffect(() => {
    if (walletAddress) {
      dispatch({ type: "ADDRESS_SYNCED", address: walletAddress });
    } else {
      dispatch({ type: "PARENT_ADDRESS_CLEARED" });
    }
  }, [walletAddress]);

  // --- Reconnect prompt for returning users -----------------------------------

  useEffect(() => {
    const checkReconnect = async () => {
      if (!walletAddress && !isWalletManualDisconnectSet() && !isReconnectPromptDismissed()) {
        const provider = getLastWalletProvider();
        if (provider) {
          const available = await isProviderAvailable(provider);
          if (available) {
            setReconnectProvider(provider);
          }
        }
      }
    };
    void checkReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Freighter polling (initial sync + heartbeat) ---------------------------

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const sync = async (): Promise<boolean> => {
      const useExtendedRetry = !initialSyncDoneRef.current;
      try {
        const manualBlock = isWalletManualDisconnectSet() && !walletAddress;
        if (manualBlock) return true;

        const reachable = await isFreighterReachable();
        const discovered = reachable
          ? useExtendedRetry
            ? await discoverConnectedAddressWithRetry()
            : await discoverConnectedAddress()
          : null;

        if (!mounted) return reachable;

        if (discovered && (walletAddress || getLastWalletProvider())) {
          clearWalletManualDisconnect();
          dispatch({ type: "ADDRESS_SYNCED", address: discovered });
          onConnect(discovered);
        } else if (!discovered && walletAddress) {
          dispatch({ type: "EXTERNAL_DISCONNECT" });
          onDisconnect("connection-lost");
          toast.info({
            title: t("toast.walletConnectionLost.title"),
            description: t("toast.walletConnectionLost.description"),
          });
        }

        return reachable;
      } catch (e) {
        console.error("Wallet connection sync failed", e);
        return false;
      } finally {
        if (useExtendedRetry && mounted) {
          initialSyncDoneRef.current = true;
          if (!IS_AUTOMATED_TEST) {
            setIsFreighterDiscovering(false);
          }
        }
      }
    };

    const scheduleNextSync = () => {
      if (!mounted) return;
      const delay = getWalletPollDelay(consecutiveFailures);
      timer = window.setTimeout(runSync, delay);
    };

    const runSync = async () => {
      const healthy = await sync();
      if (!mounted) return;
      consecutiveFailures = healthy ? 0 : consecutiveFailures + 1;
      scheduleNextSync();
    };

    void runSync();

    return () => {
      mounted = false;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [onConnect, onDisconnect, toast, walletAddress, t]);

  // --- Core connect logic (shared by handleConnect and handleRetry) -----------

  const performConnect = useCallback(async () => {
    try {
      const granted = await setAllowed();
      const isGranted = granted?.isAllowed ?? (await isAllowed()).isAllowed;

      if (isGranted) {
        const userInfo = await getAddress();

        // Freighter reports some failures in-band (`{ address: "", error }`)
        // instead of throwing — classify them so the UI receives a real code
        // (and therefore the matching i18n copy) rather than "no address".
        if (userInfo.error) {
          const error = classifyFreighterApiError(userInfo.error);
          dispatch({ type: "CONNECT_FAILED", error });
          toast.error({
            title: t("toast.walletConnectionFailed.title"),
            description: t("toast.walletConnectionFailed.description"),
          });
          return;
        }

        if (userInfo.address) {
          startWalletSession();
          clearWalletManualDisconnect();
          clearReconnectPromptDismissed();
          setLastWalletProvider("freighter");
          setReconnectProvider(null);
          dispatch({ type: "CONNECT_SUCCEEDED", address: userInfo.address });
          onConnect(userInfo.address);
          toast.success({
            title: t("toast.walletConnected.title"),
            description: t("toast.walletConnected.description"),
          });
          return;
        }

        const error = createWalletConnectionError(
          "NO_ADDRESS",
          "Unable to retrieve wallet address.",
          true,
        );
        dispatch({ type: "CONNECT_FAILED", error });
        toast.error({
          title: t("toast.walletConnectionFailed.title"),
          description: t("toast.walletConnectionFailed.description"),
        });
        return;
      }

      const denied = createWalletConnectionError(
        "PERMISSION_DENIED",
        "Freighter permission denied.",
        true,
      );
      dispatch({ type: "CONNECT_FAILED", error: denied });
      toast.warning({
        title: t("toast.walletPermissionRequired.title"),
        description: t("toast.walletPermissionRequired.description"),
      });
    } catch (e: unknown) {
      const error = classifyWalletConnectionError(e);
      dispatch({ type: "CONNECT_FAILED", error });
      const errorCopy = walletErrorI18nKeys(error.code);
      toast.error({
        title: t(errorCopy.title),
        description: t(errorCopy.description),
      });
    }
  }, [onConnect, toast, t]);

  // --- Public handlers --------------------------------------------------------

  const handleConnect = useCallback(async () => {
    dispatch({ type: "CONNECT_REQUESTED" });
    await performConnect();
  }, [performConnect]);

  const handleRetry = useCallback(async () => {
    dispatch({ type: "RETRY_REQUESTED" });
    await performConnect();
  }, [performConnect]);

  const handleDisconnect = useCallback(() => {
    dispatch({ type: "DISCONNECT_REQUESTED" });
    setWalletManualDisconnect();
    clearReconnectPromptDismissed();
    clearLastWalletProvider();
    onDisconnect("manual");
    toast.info({
      title: t("toast.walletDisconnected.title"),
      description: t("toast.walletDisconnected.description"),
    });
  }, [onDisconnect, toast, t]);

  const dismissReconnectPrompt = useCallback(() => {
    setReconnectProvider(null);
    setReconnectPromptDismissed();
    clearLastWalletProvider();
  }, []);

  // --- Derived state ----------------------------------------------------------

  const isBusy = isWalletConnecting(connection) || isFreighterDiscovering;
  const isRetrying = isWalletRetrying(connection);
  const hasError = hasWalletConnectionError(connection);
  const errorI18nKeys = connection.error
    ? walletErrorI18nKeys(connection.error.code)
    : null;

  return {
    connection,
    status: connection.status,
    isBusy,
    isRetrying,
    hasError,
    isFreighterDiscovering,
    reconnectProvider,
    dismissReconnectPrompt,
    errorI18nKeys,
    handleConnect,
    handleRetry,
    handleDisconnect,
  };
}
