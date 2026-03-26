import React from "react";
import { RefreshCw, Home, AlertOctagon } from "lucide-react";

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <div
        className="glass-panel"
        style={{
          maxWidth: "480px",
          width: "100%",
          padding: "36px 32px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "24px",
        }}
      >
        <div
          style={{
            background: "var(--bg-error)",
            color: "var(--text-error)",
            padding: "16px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "8px",
          }}
        >
          <AlertOctagon size={48} />
        </div>

        <div>
          <h1
            className="text-gradient"
            style={{ fontSize: "2rem", marginBottom: "8px" }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.05rem",
              marginBottom: "20px",
              lineHeight: "1.5",
            }}
          >
            We've encountered an unexpected issue. Our team has been notified and
            is working on it.
          </p>
          {error?.message && (
            <div
              style={{
                background: "rgba(0,0,0,0.2)",
                border: "1px solid var(--border-glass)",
                borderRadius: "var(--radius-md)",
                padding: "12px",
                fontSize: "0.9rem",
                color: "var(--text-tertiary)",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "monospace",
              }}
            >
              {error.message}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "16px",
            width: "100%",
            flexDirection: "column",
            marginTop: "8px",
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
            style={{ width: "100%", padding: "14px" }}
          >
            <RefreshCw size={18} />
            Reload Page
          </button>

          <button
            className="btn btn-outline"
            onClick={() => (window.location.href = "/")}
            style={{ width: "100%", padding: "14px" }}
          >
            <Home size={18} />
            Go Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorFallback;
