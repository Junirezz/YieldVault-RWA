import React, { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { setAllowed, isAllowed, getAddress, isConnected } from "@stellar/freighter-api";
import { LogOut, Wallet, AlertCircle } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useToast } from "../context/ToastContext";
import { useOptionalPreferencesContext } from "../context/PreferencesContext";
import { useTranslation } from "../i18n";
import { displayIdentifier } from "../lib/maskSensitiveValues";
import CopyButton from "./CopyButton";
import {
  discoverConnectedAddress,
  discoverConnectedAddressWithRetry,
} from "../lib/stellarAccount";
import {
  clearWalletManualDisconnect,
  isWalletManualDisconnectSet,
  setWalletManualDisconnect,
  getLastWalletProvider,
  setLastWalletProvider,
  clearLastWalletProvider,
  isReconnectPromptDismissed,
  setReconnectPromptDismissed,
  clearReconnectPromptDismissed,
  isProviderAvailable,
} from "../lib/walletSession";
import { Button } from "./ui/Button";
import WalletSessionIndicator from "./WalletSessionIndicator";
import WalletReconnectPrompt from "./WalletReconnectPrompt";
import {
  classifyWalletConnectionError,
  createWalletConnectionError,
  initialWalletConnectionState,
  reduceWalletConnection,
  walletErrorI18nKeys,
} from "../lib/walletConnectionState";

const IS_AUTOMATED_TEST =
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "test" || process.env.VITEST === "true");

const WALLET_POLL_INTERVAL_MS = IS_AUTOMATED_TEST ? 100 : 10_000;

/**
 * Whether Freighter still reports itself as reachable.
 *
 * An approved address can outlive the extension itself (locked, disabled, or
 * removed mid-session), so this is checked before trusting a discovered
 * address. Anything other than an explicit `false` counts as reachable, since
 * older API versions omit the flag.
 */
async function isFreighterReachable(): Promise<boolean> {
  try {
    const result = await isConnected();
    return result?.isConnected !== false;
  } catch {
    return false;
  }
}

interface WalletConnectProps {
  walletAddress: string | null;
  usdcBalance?: number;
  onConnect: (address: string) => void;
  onDisconnect: (reason?: DisconnectReason) => void;
}

export type DisconnectReason = "manual" | "session-expired" | "connection-lost";

const WalletConnect: React.FC<WalletConnectProps> = ({
  walletAddress,
  usdcBalance = 0,
  onConnect,
  onDisconnect,
}) => {
  const [connection, dispatch] = useReducer(
    reduceWalletConnection,
    initialWalletConnectionState,
  );
  const [showTooltip, setShowTooltip] = useState(false);
  const [isFreighterDiscovering, setIsFreighterDiscovering] = useState(
    () =>
      !IS_AUTOMATED_TEST &&
      typeof window !== "undefined" &&
      !isWalletManualDisconnectSet(),
  );
  const [reconnectProvider, setReconnectProvider] = useState<ReturnType<typeof getLastWalletProvider>>(null);
  const initialSyncDoneRef = useRef(false);
  const preferences = useOptionalPreferencesContext()?.preferences;
  const toast = useToast();
  const { t } = useTranslation();

  const isConnecting = connection.status === "connecting";
  const hasError = connection.status === "error" && connection.error !== null;

  // Keep machine aligned with the controlled address from the parent.
  useEffect(() => {
    if (walletAddress) {
      dispatch({ type: "ADDRESS_SYNCED", address: walletAddress });
      return;
    }
    dispatch({ type: "PARENT_ADDRESS_CLEARED" });
  }, [walletAddress]);

  // Show reconnect prompt for returning users who have a persisted provider
  useEffect(() => {
    const checkAndSetReconnectProvider = async () => {
      if (!walletAddress && !isWalletManualDisconnectSet() && !isReconnectPromptDismissed()) {
        const provider = getLastWalletProvider();
        if (provider) {
          // Validate provider is available before suggesting reconnect
          const available = await isProviderAvailable(provider);
          if (available) {
            setReconnectProvider(provider);
          }
        }
      }
    };
    void checkAndSetReconnectProvider();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const useExtendedRetry = !initialSyncDoneRef.current;
      try {
        const manualBlock = isWalletManualDisconnectSet() && !walletAddress;

        if (manualBlock) {
          return;
        }

        const reachable = await isFreighterReachable();
        const discovered = reachable
          ? useExtendedRetry
            ? await discoverConnectedAddressWithRetry()
            : await discoverConnectedAddress()
          : null;

        if (!mounted) return;

        // Adopting a discovered session silently is only safe for a wallet the
        // user has already linked here. Without a remembered provider they get
        // the reconnect prompt or the connect button instead of being signed in
        // by a session they never granted to this app.
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
      } finally {
        if (useExtendedRetry && mounted) {
          initialSyncDoneRef.current = true;
          if (!IS_AUTOMATED_TEST) {
            setIsFreighterDiscovering(false);
          }
        }
      }
    };

    void sync();
    const interval = window.setInterval(() => {
      void sync();
    }, WALLET_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [onConnect, onDisconnect, toast, walletAddress, t]);

  const handleConnect = useCallback(async () => {
    dispatch({ type: "CONNECT_REQUESTED" });
    try {
      // `setAllowed` already reports the outcome of the approval prompt; only
      // fall back to a separate `isAllowed` round-trip when it says nothing.
      const granted = await setAllowed();
      const isGranted = granted?.isAllowed ?? (await isAllowed()).isAllowed;
      if (isGranted) {
        const userInfo = await getAddress();
        if (userInfo.address) {
          // Set session start time for expiry tracking
          localStorage.setItem("wallet_session_start", Date.now().toString());
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
      console.error(e);
      const error = classifyWalletConnectionError(e);
      dispatch({ type: "CONNECT_FAILED", error });
      toast.error({
        title: t("toast.walletConnectionFailed.title"),
        description: t("toast.walletConnectionFailed.description"),
      });
    }
  }, [onConnect, toast, t]);

  useEffect(() => {
    const handleTrigger = () => {
      const btn = document.querySelector(".wallet-status, [aria-busy=\"true\"]");
      if (!btn) {
        void handleConnect();
      }
    };
    window.addEventListener("TRIGGER_WALLET_CONNECT", handleTrigger);
    return () => window.removeEventListener("TRIGGER_WALLET_CONNECT", handleTrigger);
  }, [handleConnect]);

  const formatAddress = (addr: string) => {
    if (preferences?.maskSensitiveValues) {
      return displayIdentifier(addr, true);
    }
    return `${addr.substring(0, 5)}...${addr.substring(addr.length - 4)}`;
  };

  const getErrorDescription = (): string => {
    if (!connection.error) {
      return "";
    }
    return t(walletErrorI18nKeys(connection.error.code).description);
  };

  const getStatusTooltip = (): string => {
    if (walletAddress) {
      return t("wallet.tooltip.connectedStatus");
    }
    if (isFreighterDiscovering) {
      return t("wallet.tooltip.checkingStatus");
    }
    if (isConnecting) {
      return t("wallet.tooltip.connectingStatus");
    }
    if (hasError) {
      return getErrorDescription();
    }
    return t("wallet.tooltip.disconnectedStatus");
  };

  if (walletAddress) {
    return (
      <div className="wallet-status flex items-center gap-md" data-wallet-status="connected">
        <WalletSessionIndicator walletAddress={walletAddress} />
        <div
          className="glass-panel"
          style={{
            padding: "8px 16px",
            borderRadius: "99px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid var(--accent-cyan-dim)",
            boxShadow: "0 0 10px rgba(0,240,255,0.1)",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: "var(--accent-cyan)",
              boxShadow: "0 0 8px var(--accent-cyan)",
            }}
          />
          <div className="copy-field">
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }} title={walletAddress}>
              {formatAddress(walletAddress)}
            </span>
            <CopyButton
              value={walletAddress}
              label="wallet address"
              successDescription="The full wallet address has been copied to your clipboard."
            />
          </div>
        </div>
        <div
          className="glass-panel"
          style={{
            padding: "8px 12px",
            borderRadius: "10px",
            border: "1px solid var(--border-glass)",
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            maxWidth: "260px",
          }}
          title={networkConfig.rpcUrl}
        >
          {t("wallet.rpcPrefix")} {hasCustomRpcConfig ? t("wallet.rpcCustom") : t("wallet.rpcDefault")}
        </div>
        <div
          className="glass-panel"
          style={{
            padding: "8px 12px",
            borderRadius: "10px",
            border: "1px solid var(--border-glass)",
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            minWidth: "130px",
            textAlign: "right",
          }}
          aria-label="USDC wallet balance"
        >
          USDC: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{usdcBalance.toFixed(2)}</span>
        </div>
        <button
          className="btn btn-outline"
          style={{ padding: "8px", borderRadius: "50%" }}
          onClick={() => {
            dispatch({ type: "DISCONNECT_REQUESTED" });
            setWalletManualDisconnect();
            clearReconnectPromptDismissed();
            clearLastWalletProvider();
            onDisconnect("manual");
            toast.info({
              title: t("toast.walletDisconnected.title"),
              description: t("toast.walletDisconnected.description"),
            });
          }}
          aria-label={t("wallet.disconnectAria")}
        >
          <LogOut size={18} />
        </button>
      </div>
    );
  }

  const showDiscovering = isFreighterDiscovering && !isConnecting;

  return (
    <div
      style={{ position: "relative" }}
      data-wallet-status={connection.status}
      data-error-code={connection.error?.code ?? undefined}
    >
      {reconnectProvider && !walletAddress && !isConnecting && (
        <WalletReconnectPrompt
          provider={reconnectProvider}
          onConfirm={() => {
            setReconnectProvider(null);
            void handleConnect();
          }}
          onDismiss={() => {
            setReconnectProvider(null);
            setReconnectPromptDismissed();
            clearLastWalletProvider();
          }}
        />
      )}
      <Button
        variant={hasError ? "danger" : "primary"}
        className={isConnecting || showDiscovering ? "animate-glow" : ""}
        onClick={handleConnect}
        disabled={isConnecting || showDiscovering}
        status={isConnecting || showDiscovering ? "pending" : hasError ? "error" : "idle"}
        loadingLabel={
          showDiscovering ? t("wallet.checkingFreighter") : t("wallet.connecting")
        }
        leftIcon={hasError ? <AlertCircle size={18} /> : <Wallet size={18} />}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        title={getStatusTooltip()}
        style={{ position: "relative" }}
      >
        {showDiscovering
          ? t("wallet.checkingFreighter")
          : isConnecting
            ? t("wallet.connecting")
            : t("wallet.connectFreighter")}
      </Button>

      {hasError && connection.error ? (
        <div
          className="wallet-connection-error"
          role="alert"
          aria-live="assertive"
          data-error-code={connection.error.code}
          style={{
            marginTop: "8px",
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--accent-red-dim, #f87171)",
            fontSize: "0.75rem",
            color: "var(--accent-red, #f87171)",
            maxWidth: "260px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "2px" }}>
            {t(walletErrorI18nKeys(connection.error.code).title)}
          </div>
          <div style={{ color: "var(--text-secondary)" }}>
            {t(walletErrorI18nKeys(connection.error.code).description)}
          </div>
          {connection.error.retryable ? (
            <button
              type="button"
              className="btn btn-outline"
              style={{ marginTop: "8px", padding: "4px 8px", fontSize: "0.75rem" }}
              onClick={() => void handleConnect()}
            >
              {t("wallet.retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {showTooltip && (
        <div
          className="wallet-tooltip"
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: "8px",
            padding: "8px 12px",
            backgroundColor: "var(--surface-secondary)",
            border: hasError ? "1px solid var(--accent-red-dim)" : "1px solid var(--accent-cyan-dim)",
            borderRadius: "4px",
            fontSize: "0.75rem",
            color: hasError ? "var(--accent-red)" : "var(--text-secondary)",
            whiteSpace: "normal",
            wordWrap: "break-word",
            maxWidth: "200px",
            zIndex: 1000,
            boxShadow: hasError
              ? "0 0 12px rgba(255, 80, 100, 0.15)"
              : "0 0 12px rgba(0, 240, 255, 0.15)",
            pointerEvents: "none",
          }}
        >
          {getStatusTooltip()}
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "0",
              height: "0",
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: hasError ? "4px solid var(--accent-red-dim)" : "4px solid var(--accent-cyan-dim)",
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .btn-error {
          background-color: rgba(255, 80, 100, 0.1);
          border-color: var(--accent-red-dim);
          color: var(--accent-red);
        }
        .btn-error:hover:not(:disabled) {
          background-color: rgba(255, 80, 100, 0.2);
          border-color: var(--accent-red);
          box-shadow: 0 0 12px rgba(255, 80, 100, 0.3);
        }
      `}</style>
    </div>
  );
};

export default WalletConnect;
