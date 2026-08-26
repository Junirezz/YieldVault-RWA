import React from "react";
import Skeleton from "./Skeleton";
import "./Skeleton.css";

export interface SkeletonChartProps {
  height?: string | number;
  className?: string;
  bars?: number;
}

export const SkeletonChart: React.FC<SkeletonChartProps> = ({
  height = "280px",
  className = "",
  bars = 7,
}) => {
  const formattedHeight = typeof height === "number" ? `${height}px` : height;
  const heights = ["40%", "70%", "55%", "85%", "65%", "90%", "75%"];

  return (
    <div
      className={`skeleton-chart-container ${className}`.trim()}
      style={{ height: formattedHeight }}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading chart data"
      data-testid="skeleton-chart"
    >
      <div style={{ marginBottom: "1rem" }}>
        <Skeleton variant="text" width="40%" height="22px" />
        <Skeleton variant="text" width="25%" height="14px" />
      </div>
      <div className="skeleton-chart-bars">
        {Array.from({ length: bars }).map((_, index) => (
          <div
            key={index}
            style={{
              flex: 1,
              height: heights[index % heights.length],
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            <Skeleton variant="rectangular" width="100%" height="100%" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkeletonChart;
