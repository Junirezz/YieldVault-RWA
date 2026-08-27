import React, { useState } from "react";
import { Bell, X } from "lucide-react";
import type { ToastItem } from "../context/ToastContext";
import { useToast } from "../context/ToastContext";

function groupToasts(toasts: ToastItem[]): (ToastItem & { count: number })[] {
  const groups = new Map<string, { toast: ToastItem; count: number }>();
  for (const t of toasts) {
    const key = `${t.variant}::${t.title}::${t.description ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { toast: t, count: 1 });
    }
  }
  return Array.from(groups.values()).map(({ toast, count }) => ({ ...toast, count }));
}

const ToastCenter: React.FC = () => {
  const { toasts, dismissToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const grouped = groupToasts(toasts);

  return (
    <>
      <button
        type="button"
        className="toast-center-toggle"
        onClick={() => setIsOpen((o) => !o)}
        aria-label={`Notifications (${toasts.length})`}
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          zIndex: 1001,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          color: "var(--text-primary)",
        }}
      >
        <Bell size={20} />
        {toasts.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              background: "var(--accent-orange)",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {toasts.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="toast-center-panel"
          role="dialog"
          aria-label="Notification center"
          style={{
            position: "fixed",
            bottom: "76px",
            right: "20px",
            zIndex: 1001,
            width: "360px",
            maxHeight: "400px",
            overflowY: "auto",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            padding: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <strong style={{ fontSize: "0.95rem", color: "var(--text-primary)" }}>
              Notifications
            </strong>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close notification center"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-secondary)",
                padding: "4px",
              }}
            >
              <X size={16} />
            </button>
          </div>

          {grouped.length === 0 ? (
            <p style={{ color: "var(--text-tertiary)", fontSize: "0.875rem", textAlign: "center", padding: "20px 0" }}>
              No notifications
            </p>
          ) : (
            grouped.map((g) => (
              <div
                key={`${g.id}--${g.count}`}
                className={`toast toast-${g.variant}`}
                style={{
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "var(--bg-muted)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    {g.title}
                    {g.count > 1 && (
                      <span
                        style={{
                          marginLeft: "6px",
                          fontSize: "0.75rem",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        (×{g.count})
                      </span>
                    )}
                  </div>
                  {g.description && (
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        marginTop: "2px",
                      }}
                    >
                      {g.description}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(g.id)}
                  aria-label={`Dismiss ${g.title}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-tertiary)",
                    padding: "2px",
                    flexShrink: 0,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
};

export default ToastCenter;
