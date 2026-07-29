import React, { useCallback, useEffect } from "react";
import { AlertTriangle, X, RefreshCw } from "lucide-react";
import { useTranslation } from "../i18n";
import { useAuth } from "../context/AuthContext";
import { isProviderAvailable } from "../lib/walletSession";

const SessionExpiryWarning: React.FC = () => {
  const { t } = useTranslation();
  const { sessionState, timeRemainingMs, dismissSessionWarning, renewSession } = useAuth();
  const minutesRemaining = Math.ceil(timeRemainingMs / 1000 / 60);

  useEffect(() => {
    let cancelled = false;
    const autoRenew = async () => {
      try {
        const available = await isProviderAvailable("freighter");
        if (!cancelled && available) {
          renewSession();
        }
      } catch {
        // wallet not available, user must reconnect manually
      }
    };
    autoRenew();
    return () => { cancelled = true; };
  }, [renewSession]);

  const handleReconnect = useCallback(() => {
    renewSession();
  }, [renewSession]);

  const handleDismiss = useCallback(() => {
    dismissSessionWarning();
  }, [dismissSessionWarning]);

  // The banner owns its own visibility so it can be mounted unconditionally by
  // callers that do not track session state themselves.
  if (sessionState !== "warning") {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="session-expiry-warning"
      style={{
        position: "fixed",
        top: "80px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "600px",
        width: "90%",
        background: "var(--bg-warning)",
        border: "1px solid var(--accent-orange)",
        borderRadius: "8px",
        padding: "16px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div
        style={{
          color: "var(--accent-orange)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AlertTriangle size={24} />
      </div>

      <div style={{ flex: 1 }}>
        <h3
          style={{
            margin: 0,
            fontSize: "1rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: "4px",
          }}
        >
          {t("session.warning.title")}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
            lineHeight: 1.4,
          }}
        >
          {t("session.warning.message").replace("{{minutes}}", minutesRemaining.toString())}
        </p>
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          className="btn btn-primary"
          onClick={handleReconnect}
          style={{
            padding: "8px 16px",
            fontSize: "0.875rem",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <RefreshCw size={16} />
          {t("session.warning.reconnect")}
        </button>

        <button
          className="btn btn-ghost"
          onClick={handleDismiss}
          style={{
            padding: "8px",
            borderRadius: "4px",
            color: "var(--text-secondary)",
          }}
          aria-label={t("common.dismiss")}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default SessionExpiryWarning;
