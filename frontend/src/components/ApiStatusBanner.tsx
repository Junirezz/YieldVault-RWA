import type { ApiError } from "../lib/api";

interface ApiStatusBannerProps {
  error: ApiError;
}

const ApiStatusBanner: React.FC<ApiStatusBannerProps> = ({ error }) => {
  return (
    <div
      role="alert"
      className="glass-panel"
      style={{
        padding: "16px 18px",
        marginBottom: "20px",
        background: "rgba(255, 107, 107, 0.12)",
        border: "1px solid rgba(255, 107, 107, 0.25)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>Data unavailable</div>
      <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
        {error.userMessage}
      </div>
    </div>
  );
};

export default ApiStatusBanner;
