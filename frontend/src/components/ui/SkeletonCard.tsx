import React from "react";
import Skeleton from "./Skeleton";
import "./Skeleton.css";

export interface SkeletonCardProps {
  className?: string;
  lines?: number;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  className = "",
  lines = 3,
}) => {
  return (
    <div
      className={`skeleton-card ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading content card"
      data-testid="skeleton-card"
    >
      <div className="skeleton-card-header">
        <Skeleton variant="circular" width={44} height={44} />
        <div style={{ flex: 1 }}>
          <Skeleton variant="text" width="60%" height="20px" />
          <Skeleton variant="text" width="40%" height="14px" />
        </div>
      </div>
      <Skeleton variant="rectangular" height="120px" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} variant="text" width={index === lines - 1 ? "70%" : "100%"} />
      ))}
    </div>
  );
};

export default SkeletonCard;
