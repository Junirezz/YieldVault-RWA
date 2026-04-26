import React, { useState, useEffect, useRef, useCallback } from "react";
import { setAllowed, isAllowed, getAddress } from "@stellar/freighter-api";
import { Loader2, LogOut, Wallet, AlertCircle } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useToast } from "../context/ToastContext";
import { useTranslation } from "../i18n";
import CopyButton from "./CopyButton";
import {
  discoverConnectedAddress,
  discoverConnectedAddressWithRetry,
} from "../lib/stellarAccount";
import {
  clearWalletManualDisconnect,
  isWalletManualDisconnectSet,
  setWalletManualDisconnect,
} from "../lib/walletSession";

const IS_AUTOMATED_TEST =
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "test" || process.env.VITEST === "true");

const WALLET_POLL_INTERVAL_MS = IS_AUTOMATED_TEST ? 100 : 10_000;

interface WalletConnectProps {
  walletAddress: string | null;
  usdcBalance?: number;
  onConnect: (address: string) => void;
  onDisconnect: (reason?: DisconnectReason) => void;
}

export type DisconnectReason = "manual" | "session-expired" | "connection-lost";

type ConnectionErrorType = "not-installed" | "not-allowed" | "no-address" | "generic" | null;

const WalletConnect: React.FC<WalletConnectProps> = ({
  walletAddress,
  usdcBalance = 0,
  onConnect,
  onDisconnect,
}) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<ConnectionErrorType>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isFreighterDiscovering, setIsFreighterDiscovering] = useState(
    () =>
      !IS_AUTOMATED_TEST &&
      typeof window !== "undefined" &&
      !isWalletManualDisconnectSet(),
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const initialSyncDoneRef = useRef(false);
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const useExtendedRetry = !initialSyncDoneRef.current;
      try {
        const manualBlock = isWalletManualDisconnectSet() && !walletAddress;

        if (manualBlock) {
          return;
        }

        const discovered = useExtendedRetry
          ? await discoverConnectedAddressWithRetry()
          : await discoverConnectedAddress();

        if (!mounted) return;

        if (discovered) {
          clearWalletManualDisconnect();
          onConnect(discovered);
        } else if (walletAddress) {
          onDisconnect("connection-lost");
          toast.info({
            title: "Wallet disconnected",
            description: "Freighter is no longer connected to this session.",
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
  }, [onConnect, onDisconnect, toast, walletAddress]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      await setAllowed();
      const allowed = await isAllowed();
      if (allowed.isAllowed) {
        const userInfo = await getAddress();
        if (userInfo.address) {
          // Set session start time for expiry tracking
          localStorage.setItem("wallet_session_start", Date.now().toString());
          clearWalletManualDisconnect();
          onConnect(userInfo.address);
          setConnectionError(null);
          toast.success({
            title: t("toast.walletConnected.title"),
            description: t("toast.walletConnected.description"),
          });
          return;
        } else {
          setConnectionError("no-address");
          toast.error({
            title: t("toast.walletConnectionFailed.title"),
            description: t("wallet.error.noAddress"),
          });
          return;
        }
      } else {
        setConnectionError("not-allowed");
        toast.warning({
          title: t("toast.walletPermissionRequired.title"),
          description: t("wallet.error.notAllowed"),
        });
        return;
      }
    } catch (e: unknown) {
      console.error(e);
      const error = e as Error;

      if (error.message?.includes("Freighter")) {
        setConnectionError("not-installed");
      } else {
        setConnectionError("generic");
      }

      toast.error({
        title: t("toast.walletConnectionFailed.title"),
        description: t("wallet.error.generic"),
      });
    } finally {
      setIsConnecting(false);
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
    return `${addr.substring(0, 5)}...${addr.substring(addr.length - 4)}`;
  };

  const getErrorDescription = (): string => {
    switch (connectionError) {
      case "not-installed":
        return t("wallet.error.notInstalled");
      case "not-allowed":
        return t("wallet.error.notAllowed");
      case "no-address":
        return t("wallet.error.noAddress");
      case "generic":
        return t("wallet.error.generic");
      default:
        return "";
    }
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
    if (connectionError) {
      return getErrorDescription();
    }
    return t("wallet.tooltip.disconnectedStatus");
  };

  if (walletAddress) {
    return (
      <div className="wallet-status flex items-center gap-md">
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
            setConnectionError(null);
            setWalletManualDisconnect();
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
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        className={`btn ${connectionError ? "btn-error" : "btn-primary"} ${isConnecting || showDiscovering ? "animate-glow" : ""}`}
        onClick={handleConnect}
        disabled={isConnecting || showDiscovering}
        aria-busy={isConnecting || showDiscovering}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        title={getStatusTooltip()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          position: "relative",
        }}
      >
        {isConnecting || showDiscovering ? (
          <Loader2 size={18} className="spin" style={{ animation: "spin 1s linear infinite" }} />
        ) : connectionError ? (
          <AlertCircle size={18} />
        ) : (
          <Wallet size={18} />
        )}
        <span>
          {showDiscovering
            ? t("wallet.checkingFreighter")
            : isConnecting
              ? t("wallet.connecting")
              : t("wallet.connectFreighter")}
        </span>
      </button>

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
            border: connectionError ? "1px solid var(--accent-red-dim)" : "1px solid var(--accent-cyan-dim)",
            borderRadius: "4px",
            fontSize: "0.75rem",
            color: connectionError ? "var(--accent-red)" : "var(--text-secondary)",
            whiteSpace: "normal",
            wordWrap: "break-word",
            maxWidth: "200px",
            zIndex: 1000,
            boxShadow: connectionError
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
              borderTop: connectionError ? "4px solid var(--accent-red-dim)" : "4px solid var(--accent-cyan-dim)",
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
