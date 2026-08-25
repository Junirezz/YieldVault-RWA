import React, { useEffect, useCallback, useState } from "react";
import { LogOut, Wallet, AlertCircle } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useOptionalPreferencesContext } from "../context/PreferencesContext";
import { useTranslation } from "../i18n";
import { displayIdentifier } from "../lib/maskSensitiveValues";
import CopyButton from "./CopyButton";
import { Button } from "./ui/Button";
import WalletSessionIndicator from "./WalletSessionIndicator";
import WalletReconnectPrompt from "./WalletReconnectPrompt";
import WalletConnectionStatus from "./WalletConnectionStatus";
import { walletErrorI18nKeys } from "../lib/walletConnectionState";
import { useWalletConnection } from "../hooks/useWalletConnection";

export type { DisconnectReason } from "../hooks/useWalletConnection";

interface WalletConnectProps {
  walletAddress: string | null;
  usdcBalance?: number;
  onConnect: (address: string) => void;
  onDisconnect: (reason?: import("../hooks/useWalletConnection").DisconnectReason) => void;
}

const WalletConnect: React.FC<WalletConnectProps> = ({
  walletAddress,
  usdcBalance = 0,
  onConnect,
  onDisconnect,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const preferences = useOptionalPreferencesContext()?.preferences;
  const { t } = useTranslation();

  const wallet = useWalletConnection({ walletAddress, onConnect, onDisconnect });

  const {
    connection,
    status,
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
  } = wallet;

  // Allow external code (e.g. SessionExpiredModal) to trigger a connect.
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

  const formatAddress = useCallback(
    (addr: string) => {
      if (preferences?.maskSensitiveValues) {
        return displayIdentifier(addr, true);
      }
      return `${addr.substring(0, 5)}...${addr.substring(addr.length - 4)}`;
    },
    [preferences],
  );

  const getStatusTooltip = (): string => {
    if (walletAddress) return t("wallet.tooltip.connectedStatus");
    if (isFreighterDiscovering) return t("wallet.tooltip.checkingStatus");
    if (isRetrying) return t("wallet.tooltip.retryingStatus");
    if (status === "connecting") return t("wallet.tooltip.connectingStatus");
    if (hasError && connection.error) {
      return t(walletErrorI18nKeys(connection.error.code).description);
    }
    return t("wallet.tooltip.disconnectedStatus");
  };

  // ---- Connected state -------------------------------------------------------

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
            <span
              style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              title={walletAddress}
            >
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
          USDC:{" "}
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {usdcBalance.toFixed(2)}
          </span>
        </div>

        <button
          className="btn btn-outline"
          style={{ padding: "8px", borderRadius: "50%" }}
          onClick={handleDisconnect}
          aria-label={t("wallet.disconnectAria")}
        >
          <LogOut size={18} />
        </button>
      </div>
    );
  }

  // ---- Disconnected / connecting / retrying / error state --------------------

  const showDiscovering = isFreighterDiscovering && !isBusy;
  const buttonLabel = (() => {
    if (showDiscovering) return t("wallet.checkingFreighter");
    if (isRetrying) return t("wallet.retrying");
    if (status === "connecting") return t("wallet.connecting");
    return t("wallet.connectFreighter");
  })();

  const buttonLoadingLabel = (() => {
    if (showDiscovering) return t("wallet.checkingFreighter");
    if (isRetrying) return t("wallet.retrying");
    return t("wallet.connecting");
  })();

  return (
    <div
      style={{ position: "relative" }}
      data-wallet-status={status}
      data-error-code={connection.error?.code ?? undefined}
    >
      {/* Reconnect prompt for returning users */}
      {reconnectProvider && !walletAddress && !isBusy && (
        <WalletReconnectPrompt
          provider={reconnectProvider}
          onConfirm={() => void handleConnect()}
          onDismiss={dismissReconnectPrompt}
        />
      )}

      <Button
        variant={hasError ? "danger" : "primary"}
        className={isBusy || showDiscovering ? "animate-glow" : ""}
        onClick={hasError ? handleRetry : handleConnect}
        disabled={isBusy || showDiscovering}
        status={isBusy || showDiscovering ? "pending" : hasError ? "error" : "idle"}
        loadingLabel={buttonLoadingLabel}
        leftIcon={hasError ? <AlertCircle size={18} /> : <Wallet size={18} />}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        title={getStatusTooltip()}
        style={{ position: "relative" }}
      >
        {buttonLabel}
      </Button>

      {/* Status badges for connecting / retrying / error */}
      {!walletAddress && (status === "connecting" || status === "retrying") && (
        <div style={{ marginTop: "8px" }}>
          <WalletConnectionStatus
            status={status}
            retryCount={connection.retryCount}
          />
        </div>
      )}

      {hasError && connection.error && errorI18nKeys ? (
        <WalletConnectionStatus
          status="error"
          errorTitle={t(errorI18nKeys.title)}
          errorDescription={t(errorI18nKeys.description)}
          retryable={connection.error.retryable}
          retryCount={connection.retryCount}
          onRetry={handleRetry}
          style={{ marginTop: "8px" }}
        />
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
            border: hasError
              ? "1px solid var(--accent-red-dim)"
              : "1px solid var(--accent-cyan-dim)",
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
              borderTop: hasError
                ? "4px solid var(--accent-red-dim)"
                : "4px solid var(--accent-cyan-dim)",
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
