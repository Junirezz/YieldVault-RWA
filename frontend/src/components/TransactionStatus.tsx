import React from "react";
import { AlertCircle, Check, Loader2 } from "./icons";
import { getStellarExplorerUrl, sanitizeExternalLink } from "../lib/security";

export type ActionStatusState = "idle" | "pending" | "success" | "failure";

export interface ActionStatus {
  state: ActionStatusState;
  title: string;
  description: string;
  txHash?: string;
  actionLabel?: string;
}

interface TransactionStatusProps {
  status: ActionStatus;
}

function resolveNetworkMode(): "testnet" | "mainnet" {
  const networkPassphrase =
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ?? "";
  return networkPassphrase.toLowerCase().includes("public")
    ? "mainnet"
    : "testnet";
}

const STATE_STYLES: Record<
  Exclude<ActionStatusState, "idle">,
  { border: string; icon: React.ReactNode }
> = {
  pending: {
    border: "1px solid var(--accent-purple)",
    icon: <Loader2 size={16} className="spin" />,
  },
  success: {
    border: "1px solid var(--accent-cyan-dim)",
    icon: <Check size={16} color="var(--accent-cyan)" />,
  },
  failure: {
    border: "1px solid var(--accent-red-dim)",
    icon: <AlertCircle size={16} color="var(--accent-red)" />,
  },
};

const TransactionStatus: React.FC<TransactionStatusProps> = ({ status }) => {
  if (status.state === "idle") {
    return null;
  }

  const stateStyles = STATE_STYLES[status.state];
  const explorerUrl = status.txHash
    ? sanitizeExternalLink(
        getStellarExplorerUrl(status.txHash, resolveNetworkMode()),
      )
    : null;

  return (
    <section
      aria-live="polite"
      className="glass-panel"
      style={{
        marginTop: "16px",
        padding: "14px 16px",
        borderRadius: "12px",
        border: stateStyles.border,
      }}
    >
      <div className="flex items-center gap-sm" style={{ marginBottom: "6px" }}>
        <div key={status.state} className="status-icon-wrapper">
          {stateStyles.icon}
        </div>
        <strong>{status.title}</strong>
      </div>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem" }}>
        {status.description}
      </p>
      {explorerUrl && explorerUrl !== "#" ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginTop: "8px",
            display: "inline-block",
            color: "var(--accent-cyan)",
            textDecoration: "none",
            fontSize: "0.85rem",
          }}
        >
          View {status.actionLabel ?? "transaction"} on Stellar Explorer
        </a>
      ) : null}
    </section>
  );
};

export default TransactionStatus;
