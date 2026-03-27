import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "./icons";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface StatusChip {
  label: string;
  variant?: "default" | "cyan" | "purple" | "success" | "warning" | "error";
}

export interface PageHeaderAction {
  label: string;
  onClick?: () => void;
  variant?: "primary" | "outline";
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  statusChips?: StatusChip[];
  actions?: PageHeaderAction[];
  centered?: boolean;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  breadcrumbs,
  statusChips,
  actions,
  centered = true,
}) => {
  return (
    <header
      className="page-header"
      style={{
        textAlign: centered ? "center" : "left",
        marginBottom: "48px",
      }}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="page-header-breadcrumbs"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
            justifyContent: centered ? "center" : "flex-start",
            flexWrap: "wrap",
          }}
        >
          <ol
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              listStyle: "none",
              flexWrap: "wrap",
            }}
          >
            {breadcrumbs.map((crumb, index) => (
              <li
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                {index > 0 && (
                  <ChevronRight
                    size={14}
                    aria-hidden="true"
                    style={{ color: "var(--text-tertiary)" }}
                  />
                )}
                {crumb.href ? (
                  <Link
                    to={crumb.href}
                    style={{
                      color: "var(--text-secondary)",
                      textDecoration: "none",
                      transition: "color 0.2s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.color = "var(--accent-cyan)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = "var(--text-secondary)")
                    }
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" style={{ fontWeight: 500 }}>
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div
        className="page-header-title-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: centered ? "center" : "space-between",
          gap: "16px",
          marginBottom: description || statusChips ? "16px" : "0",
          flexWrap: "wrap",
        }}
      >
        <h1
          style={{
            fontSize: "2.5rem",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            justifyContent: centered ? "center" : "flex-start",
          }}
        >
          {title}
        </h1>

        {statusChips && statusChips.length > 0 && (
          <div
            className="page-header-chips"
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              justifyContent: centered ? "center" : "flex-start",
            }}
            role="status"
            aria-live="polite"
          >
            {statusChips.map((chip, index) => (
              <span
                key={index}
                className={`tag ${chip.variant || "default"}`}
                style={{
                  ...(chip.variant === "success" && {
                    background: "rgba(34, 197, 94, 0.1)",
                    color: "#22c55e",
                    border: "1px solid rgba(34, 197, 94, 0.3)",
                  }),
                  ...(chip.variant === "warning" && {
                    background: "rgba(245, 158, 11, 0.1)",
                    color: "#f59e0b",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                  }),
                  ...(chip.variant === "error" && {
                    background: "var(--bg-error)",
                    color: "var(--text-error)",
                    border: "1px solid var(--border-error)",
                  }),
                  ...(chip.variant === "purple" && {
                    background: "rgba(112, 0, 255, 0.1)",
                    color: "#a855f7",
                    border: "1px solid rgba(112, 0, 255, 0.3)",
                  }),
                }}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {description && (
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "1.1rem",
            maxWidth: centered ? "600px" : "none",
            margin: centered ? "0 auto" : "0",
          }}
        >
          {description}
        </p>
      )}

      {actions && actions.length > 0 && (
        <div
          className="page-header-actions"
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "24px",
            justifyContent: centered ? "center" : "flex-start",
            flexWrap: "wrap",
          }}
        >
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className={`btn ${action.variant === "primary" ? "btn-primary" : "btn-outline"}`}
              onClick={action.onClick}
              disabled={action.disabled}
              style={{
                ...(action.disabled && {
                  opacity: 0.5,
                  cursor: "not-allowed",
                }),
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
};

export default PageHeader;
