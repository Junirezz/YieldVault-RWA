import React from "react";
import Skeleton from "./Skeleton";
import "./Skeleton.css";

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export const SkeletonTable: React.FC<SkeletonTableProps> = ({
  rows = 5,
  columns = 4,
  className = "",
}) => {
  return (
    <div
      className={`skeleton-table-wrapper ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading table data"
      data-testid="skeleton-table"
    >
      <div className="skeleton-table-header">
        {Array.from({ length: columns }).map((_, colIndex) => (
          <div key={colIndex} style={{ flex: 1 }}>
            <Skeleton variant="text" width="80%" height="18px" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="skeleton-table-row">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div key={colIndex} style={{ flex: 1 }}>
              <Skeleton
                variant="text"
                width={colIndex === 0 ? "90%" : "60%"}
                height="16px"
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default SkeletonTable;
