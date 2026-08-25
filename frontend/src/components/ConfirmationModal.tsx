import React, { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "./icons";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  actionType: "deposit" | "withdraw";
  amount: number;
  expectedOutput: number;
  estimatedFee: number;
  isProcessing?: boolean;
}

const LARGE_AMOUNT_THRESHOLD = 1000;

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  actionType,
  amount,
  expectedOutput,
  estimatedFee,
  isProcessing = false,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const isLargeAmount = amount >= LARGE_AMOUNT_THRESHOLD;

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        const firstInteractive = modalRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && !isProcessing) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
    },
    [isProcessing, onClose]
  );

  if (!isOpen) return null;

  const title = actionType === "deposit" ? "Confirm Deposit" : "Confirm Withdrawal";
  const subtitle = isLargeAmount
    ? "This is a large transaction. Please review carefully before proceeding."
    : "Please review your transaction details before confirming.";
  const outputLabel = actionType === "deposit" ? "Shares to Receive" : "USDC to Receive";

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
      aria-describedby="confirmation-modal-desc"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={modalRef}
        className="glass-panel"
        style={{
          padding: "32px",
          maxWidth: "440px",
          width: "100%",
          position: "relative",
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          disabled={isProcessing}
          aria-label="Close confirmation dialog"
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "transparent",
            border: "none",
            cursor: isProcessing ? "not-allowed" : "pointer",
            color: "var(--text-secondary)",
            opacity: isProcessing ? 0.5 : 1,
            transition: "color 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px",
          }}
          onMouseEnter={(e) => {
            if (!isProcessing) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
          }}
        >
          <X size={20} />
        </button>

        {isLargeAmount && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(220, 38, 38, 0.1)",
              border: "1px solid rgba(220, 38, 38, 0.3)",
              borderRadius: "var(--radius-md)",
              padding: "10px 12px",
              marginBottom: "16px",
            }}
          >
            <AlertTriangle size={18} style={{ color: "#ef4444", flexShrink: 0 }} />
            <span style={{ color: "#ef4444", fontSize: "0.85rem", fontWeight: 600 }}>
              Large transaction amount detected
            </span>
          </div>
        )}

        <h2
          id="confirmation-modal-title"
          style={{
            fontSize: "1.5rem",
            marginBottom: "8px",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
          }}
        >
          {title}
        </h2>
        <p
          id="confirmation-modal-desc"
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            marginBottom: "24px",
            lineHeight: "1.5",
          }}
        >
          {subtitle}
        </p>

        <div
          style={{
            height: "1px",
            background: "var(--border-glass)",
            margin: "24px 0",
          }}
        />

        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              {actionType === "deposit" ? "Deposit Amount" : "Withdraw Amount"}
            </span>
            <span
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                fontFamily: "var(--font-display)",
              }}
            >
              {amount.toFixed(2)} USDC
            </span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              {outputLabel}
            </span>
            <span
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                fontFamily: "var(--font-display)",
              }}
            >
              {expectedOutput.toFixed(6)} {actionType === "deposit" ? "Shares" : "USDC"}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Estimated Fee
            </span>
            <span
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                fontFamily: "var(--font-display)",
              }}
            >
              {estimatedFee.toFixed(6)} USDC
            </span>
          </div>

          <div
            style={{
              height: "1px",
              background: "var(--border-glass)",
              margin: "16px 0",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Total Cost
            </span>
            <span
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
                fontFamily: "var(--font-display)",
                color: "var(--accent-cyan)",
              }}
            >
              {(amount + estimatedFee).toFixed(6)} USDC
            </span>
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border-glass)",
            borderRadius: "var(--radius-md)",
            padding: "12px",
            marginBottom: "24px",
          }}
        >
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: "1.5" }}>
            <strong style={{ color: "var(--text-primary)" }}>Note: </strong>
            {actionType === "deposit"
              ? "Depositing USDC will mint vault shares. This action cannot be undone once confirmed on the Stellar network."
              : "Withdrawing USDC will burn your vault shares. Make sure you have sufficient shares to cover this withdrawal."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Cancel transaction"
            style={{
              padding: "12px 24px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-glass)",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.5 : 1,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!isProcessing) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-muted)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isProcessing}
            aria-label={`Confirm ${actionType}`}
            style={{
              padding: "12px 24px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "var(--accent-cyan)",
              color: "var(--bg-main)",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.7 : 1,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!isProcessing) (e.currentTarget as HTMLButtonElement).style.opacity = "0.9";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            }}
          >
            {isProcessing ? "Processing..." : `Confirm ${actionType === "deposit" ? "Deposit" : "Withdrawal"}`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default ConfirmationModal;
