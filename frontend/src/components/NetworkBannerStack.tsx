/**
 * NetworkBannerStack
 *
 * Single mount-point for all network-related banners.  Only the highest-priority
 * active condition is rendered at any time, preventing pile-up and ensuring there
 * is never more than one live `role="alert"` region on screen.
 *
 * Priority order (highest → lowest):
 *   1. offline          – device has no connectivity          (role="alert", assertive)
 *   2. network-mismatch – wallet is on the wrong network      (role="alert", assertive)
 *   3. high-latency     – probe reports degraded/slow quality (role="status", polite)
 *   4. slow-connection  – Network Information API says slow   (role="status", polite)
 *
 * When none of the above conditions are active the stack renders nothing.
 *
 * Each individual banner component is a pure renderer — it receives its
 * visibility decision from this stack rather than owning it.
 */
import React, { useState } from "react";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useNetworkQuality } from "../hooks/useNetworkQuality";
import { useWalletNetwork } from "../hooks/useWalletNetwork";
import { useRetryState } from "../hooks/useRetryState";
import { useTranslation } from "../i18n";
import { queryClient } from "../lib/queryClient";
import { AlertTriangle, Clock, WifiOff, Wifi, X } from "./icons";
import NetworkMismatchGuideModal from "./NetworkMismatchGuideModal";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BannerKind =
  | "offline"
  | "network-mismatch"
  | "high-latency"
  | "slow-connection"
  | null;

interface NetworkBannerStackProps {
  walletAddress: string | null;
  /** Last-known TVL shown in the offline banner while disconnected. */
  lastKnownTvl?: number;
  /** Last-known balance shown in the offline banner while disconnected. */
  lastKnownBalance?: number;
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

interface OfflineBannerViewProps {
  lastKnownTvl?: number;
  lastKnownBalance?: number;
  isRetrying: boolean;
  secondsUntilRetry: number | null;
  justCameOnline: boolean;
  onDismissSuccess: () => void;
}

function OfflineBannerView({
  lastKnownTvl,
  lastKnownBalance,
  isRetrying,
  secondsUntilRetry,
  justCameOnline,
  onDismissSuccess,
}: OfflineBannerViewProps) {
  const { t } = useTranslation();

  const isSuccess = justCameOnline;
  const showRetrying = !justCameOnline && isRetrying;

  return (
    <div
      className={`offline-banner ${
        isSuccess
          ? "offline-banner--success"
          : showRetrying
          ? "offline-banner--retrying"
          : "offline-banner--error"
      }`}
      role={isSuccess || showRetrying ? "status" : "alert"}
      aria-live={isSuccess || showRetrying ? "polite" : "assertive"}
      aria-atomic="true"
    >
      <div className="offline-banner__content flex justify-between items-center">
        <div className="flex items-center gap-sm">
          <span className="offline-banner__icon" aria-hidden="true">
            {isSuccess ? "✅" : showRetrying ? "🔄" : "⚠️"}
          </span>
          <span>
            {isSuccess
              ? t("offline.restored")
              : showRetrying && secondsUntilRetry !== null
              ? t("offline.retrying").replace("{{seconds}}", String(secondsUntilRetry))
              : showRetrying
              ? t("offline.reconnecting")
              : t("offline.offline")}
          </span>
          {!isSuccess && !showRetrying && (lastKnownTvl !== undefined || lastKnownBalance !== undefined) && (
            <span className="offline-banner__data">
              {lastKnownTvl !== undefined && `TVL: ${lastKnownTvl.toLocaleString()}`}
              {lastKnownTvl !== undefined && lastKnownBalance !== undefined && " · "}
              {lastKnownBalance !== undefined && `Balance: ${lastKnownBalance.toFixed(2)} USDC`}
            </span>
          )}
        </div>
        {isSuccess && (
          <button
            type="button"
            className="offline-banner__dismiss"
            onClick={onDismissSuccess}
            aria-label={t("offline.dismissAria")}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

interface MismatchBannerViewProps {
  walletNetwork: string | null;
  expectedNetwork: string;
  isChecking: boolean;
  onFixNow: () => void;
}

function MismatchBannerView({
  walletNetwork,
  expectedNetwork,
  isChecking,
  onFixNow,
}: MismatchBannerViewProps) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        top: "72px",
        left: 0,
        right: 0,
        zIndex: 200,
        background: "rgba(220, 38, 38, 0.95)",
        borderBottom: "1px solid rgba(255, 100, 100, 0.5)",
        backdropFilter: "blur(8px)",
        color: "#fff",
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "10px",
        fontSize: "0.875rem",
        lineHeight: "1.5",
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0 }} />
      <span>
        <strong>{t("networkWarning.wrongNetwork")}</strong>{" "}
        {t("networkWarning.walletOn")}{" "}
        <strong>{walletNetwork}</strong>,{" "}
        {t("networkWarning.appRequires")}{" "}
        <strong>{expectedNetwork}</strong>.{" "}
        {t("networkWarning.switchInstructions").replace("{{network}}", expectedNetwork)}
      </span>
      <button
        type="button"
        onClick={onFixNow}
        disabled={isChecking}
        style={{
          background: "rgba(255, 255, 255, 0.15)",
          border: "1px solid rgba(255, 255, 255, 0.4)",
          borderRadius: "6px",
          color: "#fff",
          padding: "4px 10px",
          fontSize: "0.8rem",
          fontWeight: 600,
          cursor: isChecking ? "default" : "pointer",
          flexShrink: 0,
          opacity: isChecking ? 0.6 : 1,
        }}
      >
        {t("networkWarning.fixNow")}
      </button>
    </div>
  );
}

interface LatencyBannerViewProps {
  quality: "slow" | "degraded";
  latencyMs: number;
  jitterMs: number;
  onDismiss: () => void;
}

function LatencyBannerView({ quality, latencyMs, jitterMs, onDismiss }: LatencyBannerViewProps) {
  const color = quality === "degraded" ? "#ef4444" : "#eab308";
  const bg =
    quality === "degraded" ? "rgba(239, 68, 68, 0.1)" : "rgba(234, 179, 8, 0.1)";
  const label =
    quality === "degraded"
      ? "Degraded network — data may be stale"
      : "Slow network — reduced refresh rate";
  const Icon = quality === "degraded" ? AlertTriangle : Clock;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 14px",
        borderRadius: "8px",
        background: bg,
        border: `1px solid ${color}33`,
        color,
        fontSize: "0.8rem",
        lineHeight: 1.4,
        marginBottom: "12px",
      }}
    >
      <Icon size={14} aria-hidden="true" />
      <span style={{ flex: 1 }}>
        {label}
        <span style={{ opacity: 0.7, fontSize: "0.72rem", marginLeft: 8 }}>
          ({latencyMs}ms{quality === "degraded" ? `, jitter ${jitterMs}ms` : ""})
        </span>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss network quality banner"
        style={{ all: "unset", cursor: "pointer", opacity: 0.6, display: "flex", padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface SlowConnectionBannerViewProps {
  effectiveType?: string;
  onDismiss: () => void;
}

function SlowConnectionBannerView({ effectiveType, onDismiss }: SlowConnectionBannerViewProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 14px",
        borderRadius: "8px",
        background: "rgba(234, 179, 8, 0.1)",
        border: "1px solid #eab30833",
        color: "#eab308",
        fontSize: "0.8rem",
        lineHeight: 1.4,
        marginBottom: "12px",
      }}
    >
      <Wifi size={14} aria-hidden="true" />
      <span style={{ flex: 1 }}>
        {`Slow connection detected${effectiveType ? ` (${effectiveType})` : ""} — updates may be delayed.`}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss slow connection banner"
        style={{ all: "unset", cursor: "pointer", opacity: 0.6, display: "flex", padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Stack ────────────────────────────────────────────────────────────────────

/**
 * The stack owns all per-banner dismissed/success state and exposes a single
 * render point so App.tsx mounts exactly one component instead of four.
 */
export const NetworkBannerStack: React.FC<NetworkBannerStackProps> = ({
  walletAddress,
  lastKnownTvl,
  lastKnownBalance,
}) => {
  // ── Network / connectivity state ──────────────────────────────────────────
  const { isOnline, isSlowConnection, effectiveType } = useNetworkStatus();
  const { quality, latencyMs, jitterMs } = useNetworkQuality();
  const { isMismatch, walletNetwork, expectedNetwork, isChecking, checkNow } =
    useWalletNetwork(walletAddress);
  const { isRetrying, secondsUntilRetry } = useRetryState();

  // ── Per-banner dismissed/success state ────────────────────────────────────
  const [latencyDismissed, setLatencyDismissed] = useState(false);
  const [slowConnDismissed, setSlowConnDismissed] = useState(false);
  const [justCameOnline, setJustCameOnline] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // Track the previous online state to detect the offline→online transition.
  const prevOnlineRef = React.useRef(isOnline);
  React.useEffect(() => {
    if (!prevOnlineRef.current && isOnline) {
      // Device just came back online — show success state briefly.
      setJustCameOnline(true);
      queryClient.invalidateQueries();
      const id = window.setTimeout(() => setJustCameOnline(false), 4_000);
      return () => window.clearTimeout(id);
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  // Reset dismissed state when latency quality worsens so the user sees the
  // new condition rather than silently suppressing it.
  const prevQualityRef = React.useRef(quality);
  React.useEffect(() => {
    const prev = prevQualityRef.current;
    prevQualityRef.current = quality;
    const worsenedToDegraded = quality === "degraded" && prev !== "degraded";
    const worsenedToSlow = quality === "slow" && prev === "fast";
    if (worsenedToDegraded || worsenedToSlow) {
      setLatencyDismissed(false);
    }
  }, [quality]);

  // ── Priority resolution ───────────────────────────────────────────────────
  const activeBanner = ((): BannerKind => {
    if (!isOnline || justCameOnline || isRetrying) return "offline";
    if (isMismatch) return "network-mismatch";
    if ((quality === "degraded" || quality === "slow") && !latencyDismissed)
      return "high-latency";
    if (isSlowConnection && !slowConnDismissed) return "slow-connection";
    return null;
  })();

  if (activeBanner === null) return null;

  return (
    <>
      {activeBanner === "offline" && (
        <OfflineBannerView
          lastKnownTvl={lastKnownTvl}
          lastKnownBalance={lastKnownBalance}
          isRetrying={isRetrying}
          secondsUntilRetry={secondsUntilRetry}
          justCameOnline={justCameOnline}
          onDismissSuccess={() => setJustCameOnline(false)}
        />
      )}

      {activeBanner === "network-mismatch" && (
        <>
          <MismatchBannerView
            walletNetwork={walletNetwork}
            expectedNetwork={expectedNetwork}
            isChecking={isChecking}
            onFixNow={() => setGuideOpen(true)}
          />
          <NetworkMismatchGuideModal
            isOpen={guideOpen}
            onClose={() => setGuideOpen(false)}
            isMismatch={isMismatch}
            isChecking={isChecking}
            walletNetwork={walletNetwork}
            expectedNetwork={expectedNetwork}
            onCheckNow={checkNow}
          />
        </>
      )}

      {activeBanner === "high-latency" && (quality === "slow" || quality === "degraded") && (
        <LatencyBannerView
          quality={quality}
          latencyMs={latencyMs}
          jitterMs={jitterMs}
          onDismiss={() => setLatencyDismissed(true)}
        />
      )}

      {activeBanner === "slow-connection" && (
        <SlowConnectionBannerView
          effectiveType={effectiveType}
          onDismiss={() => setSlowConnDismissed(true)}
        />
      )}
    </>
  );
};

export default NetworkBannerStack;
