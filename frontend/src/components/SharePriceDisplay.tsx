import React from "react";
import { Loader2, AlertTriangle } from "./icons";
import Skeleton from "./Skeleton";
import { Tooltip } from "./ui/Tooltip";
import { useSharePrice } from "../hooks/useSharePrice";

export const SharePriceDisplay: React.FC = () => {
  const { sharePrice, isLoading, isRefetching, error } = useSharePrice();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        marginTop: "8px",
        color: "var(--text-secondary)",
        fontSize: "0.82rem",
        display: "flex",
        alignItems: "center",
        gap: "4px",
      }}
    >
      <span>1 yvUSDC =&nbsp;</span>

      {/* State: loading (no price yet) */}
      {isLoading && sharePrice === null && (
        <Skeleton width="120px" height="1.25rem" />
      )}

      {/* State: error, no stale price */}
      {!isLoading && sharePrice === null && error && (
        <span style={{ color: "var(--text-secondary)" }}>Unavailable</span>
      )}

      {/* State: price available (loaded / refetching / error-with-stale) */}
      {sharePrice !== null && (
        <>
          <span>{sharePrice.toFixed(4)} USDC</span>

          {isRefetching && (
            <Loader2
              size={14}
              aria-hidden="true"
              style={{ marginLeft: "4px", animation: "spin 0.9s linear infinite" }}
            />
          )}

          {error && !isRefetching && (
            <Tooltip
              content="Share price could not be refreshed. Showing last known value."
              placement="top"
            >
              <AlertTriangle
                size={14}
                aria-label="Share price data may be stale"
                style={{ marginLeft: "4px", color: "var(--text-warning)", cursor: "help" }}
              />
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
};

export default SharePriceDisplay;
