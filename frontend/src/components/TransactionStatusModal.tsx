import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Loader2, Check, AlertCircle, Copy, X } from "./icons";
import { getStellarExplorerUrl, sanitizeExternalLink } from "../lib/security";

export type TransactionStatusState = "submitting" | "confirming" | "success" | "failure";

interface TransactionStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  txHash: string | null;
  actionType: "deposit" | "withdraw";
  amount: number;
  error?: string | null;
  onSuccess?: () => void;
  onFailure?: (error: string) => void;
  mockMode?: boolean;
}

const HORIZON_BASE_URL = "https://horizon-testnet.stellar.org";

function resolveNetworkMode(): "testnet" | "mainnet" {
  const networkPassphrase =
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ?? "";
  return networkPassphrase.toLowerCase().includes("public")
    ? "mainnet"
    : "testnet";
}

const TransactionStatusModal: React.FC<TransactionStatusModalProps> = ({
  isOpen,
  onClose,
  txHash,
  actionType,
  amount,
  error: externalError,
  onSuccess,
  onFailure,
  mockMode,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [state, setState] = useState<TransactionStatusState>("submitting");
  const [internalError, setInternalError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [copied, setCopied] = useState(false);

  // Determine actual error message to display
  const displayError = externalError || internalError;

  // Handle focus trapping and keyboard esc
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        const firstInteractive = modalRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        firstInteractive?.focus();
      });
    }

    return () => {
      if (isOpen) {
        previousFocusRef.current?.focus();
      }
    };
  }, [isOpen]);

  // Keydown listener for modal trapping
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && (state === "success" || state === "failure")) {
      onClose();
      return;
    }

    if (event.key !== "Tab" || !modalRef.current) {
      return;
    }

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];
    const activeElement = document.activeElement as HTMLElement | null;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  // Determine if it's a simulated transaction
  const isMock = mockMode !== undefined ? mockMode : (!txHash || txHash.startsWith("mock_"));

  // Check transaction status on Stellar Horizon
  const checkTxStatus = useCallback(async (hash: string): Promise<boolean> => {
    const url = `${HORIZON_BASE_URL}/transactions/${hash}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        return !!data.successful;
      }
      if (response.status === 404) {
        // Still pending
        return false;
      }
      throw new Error(`Horizon API returned status ${response.status}`);
    } catch (err: any) {
      // Don't fail immediately on network flakes, let polling retry unless we hit max attempts
      console.warn("Horizon poll attempt failed:", err.message);
      return false;
    }
  }, []);

  // Update state based on external props
  useEffect(() => {
    if (externalError) {
      setState("failure");
    } else if (txHash && state === "submitting") {
      setState("confirming");
      setPollCount(0);
    }
  }, [txHash, externalError, state]);

  // Reset modal state on reopen
  useEffect(() => {
    if (isOpen) {
      setState(txHash ? "confirming" : "submitting");
      setInternalError(null);
      setPollCount(0);
      setCopied(false);
    }
  }, [isOpen, txHash]);

  // Polling logic
  useEffect(() => {
    if (!isOpen || state !== "confirming" || !txHash) return;

    let timer: NodeJS.Timeout;
    const maxPolls = 15; // 30 seconds total at 2s interval

    const poll = async () => {
      if (isMock) {
        // Simulated polling
        setPollCount((prev) => {
          const next = prev + 1;
          if (next >= 3) {
            // Mock transaction success (90% chance) or fail (10% chance)
            const isSuccess = Math.random() < 0.9;
            if (isSuccess) {
              setState("success");
              onSuccess?.();
            } else {
              setInternalError("Mock transaction failed ledger verification.");
              setState("failure");
              onFailure?.("Mock transaction failed ledger verification.");
            }
          }
          return next;
        });
      } else {
        // Real Stellar network polling
        const isConfirmed = await checkTxStatus(txHash);
        if (isConfirmed) {
          setState("success");
          onSuccess?.();
        } else {
          setPollCount((prev) => {
            const next = prev + 1;
            if (next >= maxPolls) {
              setInternalError("Transaction polling timed out. Please check Stellar Explorer.");
              setState("failure");
              onFailure?.("Transaction polling timed out.");
            }
            return next;
          });
        }
      }
    };

    timer = setInterval(poll, 2000);

    return () => {
      clearInterval(timer);
    };
  }, [isOpen, state, txHash, isMock, checkTxStatus, onSuccess, onFailure]);

  // Copy hash handler
  const handleCopyHash = () => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const truncateHash = (hash: string) => {
    if (!hash) return "";
    return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
  };

  const explorerUrl = txHash
    ? sanitizeExternalLink(getStellarExplorerUrl(txHash, resolveNetworkMode()))
    : null;

  return createPortal(
    <div
      className="session-expired-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-overlay)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-modal-title"
      aria-describedby="tx-modal-desc"
    >
      <div
        ref={modalRef}
        className="glass-panel"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: "460px",
          padding: "28px",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "20px",
          boxShadow: "var(--shadow-glass)",
          position: "relative",
          margin: "16px",
          outline: "none",
        }}
      >
        {/* Close button for final states */}
        {(state === "success" || state === "failure") && (
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        )}

        {/* State Icon Indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background:
              state === "success"
                ? "rgba(0, 240, 255, 0.1)"
                : state === "failure"
                  ? "var(--bg-error)"
                  : "rgba(112, 0, 255, 0.1)",
            border: `1px solid ${
              state === "success"
                ? "var(--accent-cyan-dim)"
                : state === "failure"
                  ? "var(--border-error)"
                  : "rgba(112, 0, 255, 0.3)"
            }`,
            marginBottom: "8px",
          }}
        >
          {state === "success" && <Check size={32} color="var(--accent-cyan)" />}
          {state === "failure" && <AlertCircle size={32} color="var(--text-error)" />}
          {(state === "submitting" || state === "confirming") && (
            <Loader2
              size={32}
              color={state === "confirming" ? "var(--accent-cyan)" : "var(--accent-purple)"}
              className="spin"
              style={{ animation: "spin 1s linear infinite" }}
            />
          )}
        </div>

        {/* Status Messaging */}
        <div style={{ textAlign: "center", width: "100%" }}>
          <h1
            id="tx-modal-title"
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              marginBottom: "8px",
              color: "var(--text-primary)",
            }}
          >
            {state === "submitting" && "Sign Transaction"}
            {state === "confirming" && "Confirming on Ledger"}
            {state === "success" && "Transaction Successful"}
            {state === "failure" && "Transaction Failed"}
          </h1>
          <p
            id="tx-modal-desc"
            style={{
              fontSize: "0.95rem",
              color: "var(--text-secondary)",
              lineHeight: "1.5",
              margin: 0,
            }}
          >
            {state === "submitting" && "Please approve the transaction in your Freighter wallet extension."}
            {state === "confirming" &&
              `Broadcasting to Stellar. Waiting for ledger confirmation... (poll #${pollCount})`}
            {state === "success" &&
              `Your transaction has been confirmed on the Stellar network.`}
            {state === "failure" && (displayError || "An unexpected error occurred.")}
          </p>
        </div>

        {/* Transaction Info Panel */}
        <div
          className="glass-panel"
          style={{
            width: "100%",
            padding: "16px",
            background: "rgba(0, 0, 0, 0.15)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Transaction Type</span>
            <span style={{ fontWeight: 600, textTransform: "capitalize", fontSize: "0.9rem" }}>
              {actionType}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Amount</span>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              {amount.toFixed(2)} USDC
            </span>
          </div>

          {txHash && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Transaction Hash</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "var(--text-primary)" }}>
                  {truncateHash(txHash)}
                </span>
                <button
                  onClick={handleCopyHash}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "2px",
                    color: copied ? "var(--accent-cyan)" : "var(--text-secondary)",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Copy transaction hash"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div style={{ width: "100%", marginTop: "8px" }}>
          {state === "success" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ width: "100%", textDecoration: "none", textAlign: "center", display: "block" }}
                >
                  View on Stellar Explorer
                </a>
              )}
              <button className="btn btn-primary" onClick={onClose} style={{ width: "100%" }}>
                Close
              </button>
            </div>
          )}

          {state === "failure" && (
            <button className="btn btn-primary" onClick={onClose} style={{ width: "100%" }}>
              Close
            </button>
          )}

          {(state === "submitting" || state === "confirming") && (
            <button className="btn btn-outline" disabled style={{ width: "100%", opacity: 0.6 }}>
              Transaction in Progress...
            </button>
          )}
        </div>

        {/* Local styling for animations */}
        <style>{`
          .spin {
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    </div>,
    document.body,
  );
};

export default TransactionStatusModal;
