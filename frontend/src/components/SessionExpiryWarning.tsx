import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, X, Wallet } from "lucide-react";
import { useTranslation } from "../i18n";

interface SessionExpiryWarningProps {
  onReconnect: () => void;
  onDismiss: () => void;
}

const SessionExpiryWarning: React.FC<SessionExpiryWarningProps> = ({
  onReconnect,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const checkSession = () => {
      const sessionStart = localStorage.getItem("wallet_session_start");
      if (!sessionStart) {
        setIsVisible(false);
        return;
      }

      const startTime = parseInt(sessionStart, 10);
      const now = Date.now();
      const sessionDuration = now - startTime;
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes
      const warningTime = 5 * 60 * 1000; // 5 minutes before expiry

      if (sessionDuration >= sessionTimeout - warningTime && sessionDuration < sessionTimeout) {
        // Show warning: session is within warning period but not yet expired
        const timeRemainingMs = sessionTimeout - sessionDuration;
        setTimeRemaining(Math.ceil(timeRemainingMs / 1000 / 60)); // minutes remaining
        setIsVisible(true);
      } else if (sessionDuration >= sessionTimeout) {
        // Session has expired
        setIsVisible(false);
      } else {
        // Not yet time to show warning
        setIsVisible(false);
      }
    };

    // Check immediately on mount
    checkSession();

    // Then check every second
    const interval = setInterval(checkSession, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleReconnect = useCallback(() => {
    // Update session start time
    localStorage.setItem("wallet_session_start", Date.now().toString());
    onReconnect();
    setIsVisible(false);
  }, [onReconnect]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss();
  }, [onDismiss]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
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
          {t("session.warning.message").replace("{{minutes}}", timeRemaining.toString())}
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
          <Wallet size={16} />
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