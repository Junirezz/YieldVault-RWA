import React, { useState, useCallback, useEffect } from "react";
import { AlertTriangle, Wifi, ExternalLink } from "./icons";
import { useWalletNetwork } from "../hooks/useWalletNetwork";
import { useTranslation } from "../i18n";

interface NetworkSwitchNotificationProps {
  walletAddress: string | null;
  onSwitchNetwork?: (network: "testnet" | "mainnet") => Promise<void>;
}

const STELLAR_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const STELLAR_MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

function detectExpectedNetwork(): "testnet" | "mainnet" {
  const passphrase = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ?? "";
  return passphrase.includes("Public") ? "mainnet" : "testnet";
}

const NetworkSwitchNotification: React.FC<NetworkSwitchNotificationProps> = ({
  walletAddress,
  onSwitchNetwork,
}) => {
  const {
    isMismatch,
    walletNetwork,
    expectedNetwork,
    isChecking,
    checkNow,
  } = useWalletNetwork(walletAddress);
  const { t } = useTranslation();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  // Reset dismissed state when mismatch changes
  useEffect(() => {
    if (!isMismatch) {
      setIsDismissed(false);
      setShowSteps(false);
    }
  }, [isMismatch]);

  const handleSwitch = useCallback(async () => {
    if (!onSwitchNetwork) return;
    setIsSwitching(true);
    try {
      await onSwitchNetwork(expectedNetwork as "testnet" | "mainnet");
    } catch {
      // Switch failed - user may need to do it manually
    } finally {
      setIsSwitching(false);
    }
  }, [onSwitchNetwork, expectedNetwork]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
  }, []);

  if (!isMismatch || isDismissed) return null;

  const walletNet = walletNetwork || "Unknown";
  const appNet = expectedNetwork || detectExpectedNetwork();

  const getManualSteps = () => {
    if (appNet === "testnet") {
      return [
        "Open your Stellar wallet extension",
        'Navigate to network settings or preferences',
        'Select "Testnet" from the network options',
        "Approve the network switch in your wallet",
      ];
    }
    return [
      "Open your Stellar wallet extension",
      "Navigate to network settings or preferences",
      'Select "Public (Mainnet)" from the network options',
      "Approve the network switch in your wallet",
    ];
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="network-switch-notification"
      style={{
        position: "fixed",
        top: "72px",
        left: 0,
        right: 0,
        zIndex: 250,
        background: "rgba(220, 38, 38, 0.95)",
        borderBottom: "1px solid rgba(255, 100, 100, 0.5)",
        backdropFilter: "blur(8px)",
        color: "#fff",
        padding: "12px 24px",
        fontSize: "0.875rem",
        lineHeight: "1.5",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <AlertTriangle size={18} style={{ flexShrink: 0 }} aria-hidden="true" />
          <div>
            <span>
              <strong>Network mismatch detected:</strong> Your wallet is on{" "}
              <strong>{walletNet}</strong>, but this app requires{" "}
              <strong>{appNet}</strong>.
            </span>
            {!showSteps && (
              <span
                style={{
                  display: "inline-block",
                  marginLeft: "8px",
                  color: "rgba(255,255,255,0.8)",
                  fontSize: "0.8rem",
                }}
              >
                Transactions will fail until the network matches.
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {onSwitchNetwork && (
            <button
              type="button"
              onClick={handleSwitch}
              disabled={isSwitching}
              aria-label={`Switch wallet to ${appNet} network`}
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                border: "1px solid rgba(255, 255, 255, 0.4)",
                borderRadius: "6px",
                color: "#fff",
                padding: "6px 12px",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: isSwitching ? "not-allowed" : "pointer",
                opacity: isSwitching ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Wifi size={12} />
              {isSwitching ? "Switching..." : `Switch to ${appNet}`}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowSteps(!showSteps)}
            aria-expanded={showSteps}
            aria-label={showSteps ? "Hide switch instructions" : "Show switch instructions"}
            style={{
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.3)",
              borderRadius: "6px",
              color: "#fff",
              padding: "6px 12px",
              fontSize: "0.8rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {showSteps ? "Hide Steps" : "How to Fix"}
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss network notification"
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.7)",
              padding: "4px",
              cursor: "pointer",
              fontSize: "1rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {showSteps && (
        <div
          style={{
            maxWidth: "1200px",
            margin: "10px auto 0",
            padding: "12px",
            background: "rgba(0,0,0,0.2)",
            borderRadius: "8px",
            fontSize: "0.85rem",
          }}
        >
          <ol
            style={{
              margin: "0 0 8px 0",
              paddingLeft: "20px",
            }}
          >
            {getManualSteps().map((step, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>
                {step}
              </li>
            ))}
          </ol>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={() => checkNow()}
              disabled={isChecking}
              aria-label="Recheck wallet network"
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: "4px",
                color: "#fff",
                padding: "4px 8px",
                fontSize: "0.75rem",
                cursor: isChecking ? "not-allowed" : "pointer",
              }}
            >
              {isChecking ? "Checking..." : "Re-check Network"}
            </button>
            <a
              href="https://docs.stellar.org/learn/getting-started/testnet"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Stellar network documentation (opens in new tab)"
              style={{
                color: "rgba(255,255,255,0.9)",
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                textDecoration: "underline",
              }}
            >
              Stellar docs
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkSwitchNotification;
