import React, { useEffect, useState } from "react";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { AlertTriangle, WifiOff, X } from "./icons";

const NetworkBanner: React.FC = () => {
  const { isOnline, isSlowConnection, effectiveType } = useNetworkStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isOnline) setDismissed(false);
  }, [isOnline]);

  if (isOnline && !isSlowConnection) return null;
  if (isOnline && isSlowConnection && dismissed) return null;

  const isOffline = !isOnline;
  const message = isOffline
    ? "You're offline. Some data may be outdated until your connection is restored."
    : `Slow connection detected${effectiveType ? ` (${effectiveType})` : ""} — updates may be delayed.`;

  return (
    <div
      role="alert"
      aria-live={isOffline ? "assertive" : "polite"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 14px",
        borderRadius: "8px",
        background: isOffline ? "rgba(239, 68, 68, 0.1)" : "rgba(234, 179, 8, 0.1)",
        border: `1px solid ${isOffline ? "#ef4444" : "#eab308"}33`,
        color: isOffline ? "#ef4444" : "#eab308",
        fontSize: "0.8rem",
        lineHeight: 1.4,
        marginBottom: "12px",
      }}
    >
      {isOffline ? <WifiOff size={14} /> : <AlertTriangle size={14} />}
      <span style={{ flex: 1 }}>{message}</span>
      {!isOffline && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            all: "unset",
            cursor: "pointer",
            opacity: 0.6,
            display: "flex",
            padding: 2,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default NetworkBanner;
