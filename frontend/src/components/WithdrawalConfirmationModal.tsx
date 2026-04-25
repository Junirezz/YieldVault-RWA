import React from "react";
import { X } from "./icons";

interface WithdrawalConfirmationModalProps {
  isOpen: boolean;
  amount: number;
  estimatedFee: number;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

const WithdrawalConfirmationModal: React.FC<WithdrawalConfirmationModalProps> = ({
  isOpen,
  amount,
  estimatedFee,
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  if (!isOpen) return null;

  const totalAmount = amount + estimatedFee;

  return (
    <div
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
      onClick={onCancel}
    >
      <div
        className="glass-panel"
        style={{
          padding: "32px",
          maxWidth: "420px",
          width: "100%",
          position: "relative",
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onCancel}
          disabled={isProcessing}
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
            if (!isProcessing) {
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-primary)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-secondary)";
          }}
        >
          <X size={20} />
        </button>

        {/* Header */}
        <h2
          style={{
            fontSize: "1.5rem",
            marginBottom: "8px",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
          }}
        >
          Confirm Withdrawal
        </h2>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            marginBottom: "24px",
          }}
        >
          Please review the details before confirming your withdrawal.
        </p>

        {/* Divider */}
        <div
          style={{
            height: "1px",
            background: "var(--border-glass)",
            margin: "24px 0",
          }}
        />

        {/* Details */}
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
              Withdrawal Amount
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
              Estimated Network Fee
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
              Total Deducted
            </span>
            <span
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
                fontFamily: "var(--font-display)",
                color: "var(--accent-cyan)",
              }}
            >
              {totalAmount.toFixed(6)} USDC
            </span>
          </div>
        </div>

        {/* Warning */}
        <div
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border-glass)",
            borderRadius: "var(--radius-md)",
            padding: "12px",
            marginBottom: "24px",
          }}
        >
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
              lineHeight: "1.5",
            }}
          >
            <strong style={{ color: "var(--text-primary)" }}>Note:</strong> This
            action will immediately withdraw your funds from the vault. Your
            shares will be burned and cannot be recovered.
          </p>
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCancel}
            disabled={isProcessing}
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
              if (!isProcessing) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--bg-muted)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isProcessing}
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
              if (!isProcessing) {
                (e.currentTarget as HTMLButtonElement).style.opacity = "0.9";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            }}
          >
            {isProcessing ? "Processing..." : "Confirm Withdrawal"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WithdrawalConfirmationModal;
