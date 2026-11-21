import React, { useEffect, useRef } from "react";
import { Bell, CheckCircle2, ExternalLink, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useWithdrawalNotifications } from "../context/WithdrawalNotificationContext";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useTranslation } from "../i18n";

export interface NotificationBellProps {
  className?: string;
  style?: React.CSSProperties;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  className = "",
  style = {},
}) => {
  const { t } = useTranslation();
  const {
    notifications,
    unreadCount,
    isOpen,
    togglePanel,
    closePanel,
    clearAll,
    dismissNotification,
  } = useWithdrawalNotifications();

  const bellContainerRef = useRef<HTMLDivElement>(null);

  const panelRef = useFocusTrap<HTMLDivElement>({
    active: isOpen,
    onEscape: closePanel,
    closeOnEscape: true,
    trapTab: false,
    lockScroll: false,
  });

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        bellContainerRef.current &&
        !bellContainerRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, closePanel]);

  const toggleAriaLabel =
    unreadCount > 0
      ? t("notifications.bellUnreadLabel", {
          count: unreadCount,
          defaultValue: `Notifications (${unreadCount} unread)`,
        })
      : t("notifications.bellLabel", {
          defaultValue: "Notifications",
        });

  return (
    <div
      ref={bellContainerRef}
      className={`notification-bell-container ${className}`}
      style={{ position: "relative", display: "inline-flex", ...style }}
    >
      <button
        type="button"
        className="notification-bell-button"
        aria-label={toggleAriaLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={togglePanel}
        style={{
          position: "relative",
          background: "transparent",
          border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
          borderRadius: "8px",
          padding: "8px",
          color: "var(--text-primary, #fff)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s ease",
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="notification-bell-badge"
            data-testid="notification-badge"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-5px",
              right: "-5px",
              background: "var(--accent-orange, #f97316)",
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: 700,
              minWidth: "18px",
              height: "18px",
              borderRadius: "999px",
              padding: "0 4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 0 6px rgba(249, 115, 22, 0.6)",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="notification-center-panel"
          role="dialog"
          aria-label={t("notifications.heading", {
            defaultValue: "Withdrawal Alerts",
          })}
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 1002,
            width: "360px",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "440px",
            overflowY: "auto",
            background: "var(--bg-surface, #131722)",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))",
            borderRadius: "12px",
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.35)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
              paddingBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <strong
                style={{
                  fontSize: "0.95rem",
                  color: "var(--text-primary, #fff)",
                }}
              >
                {t("notifications.heading", {
                  defaultValue: "Withdrawal Alerts",
                })}
              </strong>
              {notifications.length > 0 && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-tertiary, #94a3b8)",
                  }}
                >
                  ({notifications.length})
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  aria-label={t("notifications.clearAll", {
                    defaultValue: "Clear all",
                  })}
                  title={t("notifications.clearAll", {
                    defaultValue: "Clear all",
                  })}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-secondary, #94a3b8)",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 6px",
                    borderRadius: "4px",
                  }}
                >
                  <Trash2 size={13} />
                  <span>
                    {t("notifications.clearAll", { defaultValue: "Clear" })}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={closePanel}
                aria-label={t("notifications.closeLabel", {
                  defaultValue: "Close notifications",
                })}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-secondary, #94a3b8)",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          {notifications.length === 0 ? (
            <p
              style={{
                color: "var(--text-tertiary, #94a3b8)",
                fontSize: "0.875rem",
                textAlign: "center",
                padding: "24px 8px",
                margin: 0,
              }}
            >
              {t("notifications.emptyWithdrawals", {
                defaultValue: "No withdrawal alerts yet.",
              })}
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {notifications.map((item) => (
                <div
                  key={item.id}
                  className="notification-item"
                  style={{
                    background: "var(--bg-muted, rgba(255, 255, 255, 0.04))",
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <CheckCircle2
                        size={15}
                        style={{
                          color: "var(--accent-green, #22c55e)",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          color: "var(--text-primary, #fff)",
                        }}
                      >
                        {item.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => dismissNotification(item.id)}
                      aria-label={t("notifications.dismiss", {
                        defaultValue: "Dismiss notification",
                      })}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-tertiary, #94a3b8)",
                        cursor: "pointer",
                        padding: "2px",
                        lineHeight: 1,
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>

                  <p
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-secondary, #cbd5e1)",
                      margin: 0,
                    }}
                  >
                    {item.description}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "2px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-tertiary, #94a3b8)",
                      }}
                    >
                      {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>

                    <Link
                      to={
                        item.transactionHash
                          ? `/receipt/${item.transactionHash}`
                          : "/transactions"
                      }
                      className="notification-tx-link"
                      onClick={closePanel}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "0.78rem",
                        color: "var(--accent-cyan, #00f0ff)",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      <span>
                        {t("notifications.viewTransaction", {
                          defaultValue: "View transaction",
                        })}
                      </span>
                      <ExternalLink size={12} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
