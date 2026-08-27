/**
 * WalletConnectionStatus
 *
 * Renders a clear, accessible status indicator for each wallet connection state:
 *   disconnected | connecting | retrying | connected | error
 *
 * Designed to be embedded inside WalletConnect or used standalone wherever
 * connection state feedback is needed (e.g. OnboardingPanel).
 */

import React from "react";
import { AlertCircle, CheckCircle, Loader, Wallet, WifiOff } from "lucide-react";
import { useTranslation } from "../i18n";
import type { WalletConnectionStatus as WalletStatus } from "../lib/walletConnectionState";

export interface WalletConnectionStatusProps {
  /** Current connection machine status. */
  status: WalletStatus;
  /** Actionable error title (i18n key resolved). Pass null when no error. */
  errorTitle?: string | null;
  /** Actionable error description (i18n key resolved). Pass null when no error. */
  errorDescription?: string | null;
  /** Whether the error is retryable (shows a Retry button when true). */
  retryable?: boolean;
  /** Number of retry attempts so far (shown in retrying state). */
  retryCount?: number;
  /** Callback for the retry button. */
  onRetry?: () => void;
  /** Optional CSS class override. */
  className?: string;
  /** Optional inline style override. */
  style?: React.CSSProperties;
}

/**
 * Inline spinning loader SVG — avoids a dependency on an animation library.
 * Uses a CSS keyframe animation already present in the project.
 */
const SpinnerIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <Loader
    size={size}
    aria-hidden="true"
    style={{ animation: "spin 1s linear infinite" }}
  />
);

const WalletConnectionStatus: React.FC<WalletConnectionStatusProps> = ({
  status,
  errorTitle,
  errorDescription,
  retryable = true,
  retryCount = 0,
  onRetry,
  className = "",
  style,
}) => {
  const { t } = useTranslation();

  if (status === "connected") {
    // Connected state is rendered by the parent (address pill + balance).
    return null;
  }

  if (status === "disconnected") {
    return (
      <div
        className={`wallet-status-badge wallet-status-badge--disconnected ${className}`}
        role="status"
        aria-label={t("wallet.status.disconnected")}
        style={{ ...badgeStyles("neutral"), ...style }}
      >
        <WifiOff size={14} aria-hidden="true" />
        <span>{t("wallet.status.disconnected")}</span>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div
        className={`wallet-status-badge wallet-status-badge--connecting ${className}`}
        role="status"
        aria-live="polite"
        aria-label={t("wallet.status.connecting")}
        style={{ ...badgeStyles("info"), ...style }}
      >
        <SpinnerIcon size={14} />
        <span>{t("wallet.status.connecting")}</span>
      </div>
    );
  }

  if (status === "retrying") {
    return (
      <div
        className={`wallet-status-badge wallet-status-badge--retrying ${className}`}
        role="status"
        aria-live="polite"
        aria-label={t("wallet.status.retrying")}
        style={{ ...badgeStyles("warning"), ...style }}
      >
        <SpinnerIcon size={14} />
        <span>
          {t("wallet.status.retrying")}
          {retryCount > 1 && (
            <span
              style={{ marginLeft: "4px", opacity: 0.75, fontSize: "0.7em" }}
              aria-label={`attempt ${retryCount}`}
            >
              ({retryCount})
            </span>
          )}
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={`wallet-status-badge wallet-status-badge--error ${className}`}
        role="alert"
        aria-live="assertive"
        style={{ ...containerStyles(), ...style }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: errorDescription ? "4px" : 0 }}>
          <AlertCircle size={16} aria-hidden="true" />
          <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>
            {errorTitle ?? t("wallet.status.error")}
          </span>
        </div>

        {errorDescription && (
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            {errorDescription}
          </p>
        )}

        {retryable && onRetry && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={onRetry}
            style={{ padding: "4px 10px", fontSize: "0.75rem", marginTop: "2px" }}
          >
            <Wallet size={12} style={{ marginRight: "4px" }} aria-hidden="true" />
            {t("wallet.retry")}
          </button>
        )}
      </div>
    );
  }

  return null;
};

// ---- Style helpers -----------------------------------------------------------

type BadgeTone = "neutral" | "info" | "warning";

function badgeStyles(tone: BadgeTone): React.CSSProperties {
  const toneMap: Record<BadgeTone, { bg: string; border: string; color: string }> = {
    neutral: {
      bg: "rgba(255,255,255,0.05)",
      border: "1px solid var(--border-glass)",
      color: "var(--text-secondary)",
    },
    info: {
      bg: "rgba(0,240,255,0.08)",
      border: "1px solid var(--accent-cyan-dim)",
      color: "var(--accent-cyan)",
    },
    warning: {
      bg: "rgba(255,200,0,0.08)",
      border: "1px solid rgba(255,200,0,0.3)",
      color: "var(--warning, #fbbf24)",
    },
  };

  const { bg, border, color } = toneMap[tone];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "99px",
    fontSize: "0.75rem",
    fontWeight: 500,
    background: bg,
    border,
    color,
    userSelect: "none",
  };
}

function containerStyles(): React.CSSProperties {
  return {
    marginTop: "8px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid var(--accent-red-dim, #f87171)",
    fontSize: "0.8rem",
    color: "var(--accent-red, #f87171)",
    maxWidth: "260px",
    background: "rgba(255,80,100,0.06)",
  };
}

// Helper: a compact "connected" badge for cases where only a status pill is needed
export const WalletConnectedBadge: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { t } = useTranslation();
  return (
    <div
      className={`wallet-status-badge wallet-status-badge--connected ${className}`}
      role="status"
      aria-label={t("wallet.status.connected")}
      style={badgeStyles("info")}
    >
      <CheckCircle size={14} aria-hidden="true" style={{ color: "var(--accent-cyan)" }} />
      <span>{t("wallet.status.connected")}</span>
    </div>
  );
};

export default WalletConnectionStatus;
