import React from "react";
import "./Skeleton.css";

export type SkeletonVariant = "text" | "circular" | "rectangular";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = "text",
  width,
  height,
  className = "",
  style,
  ariaLabel = "Loading...",
}) => {
  const customStyles: React.CSSProperties = {
    ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
    ...style,
  };

  return (
    <div
      className={`skeleton-base skeleton-variant-${variant} ${className}`.trim()}
      style={customStyles}
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="skeleton"
    >
      <span className="sr-only">{ariaLabel}</span>
    </div>
  );
};

export default Skeleton;
