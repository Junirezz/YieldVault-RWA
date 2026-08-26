import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { skeletonPulse } from '../motion/variants';

export interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  circle?: boolean;
  style?: React.CSSProperties;
}

export const SkeletonBlock: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  borderRadius,
  circle,
  style,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const baseStyle: React.CSSProperties = {
    width: width,
    height: height,
    borderRadius: circle ? '50%' : borderRadius,
    ...style,
  };

  return (
    <motion.div
      className={`skeleton ${className}`}
      style={baseStyle}
      aria-hidden="true"
      variants={prefersReducedMotion ? undefined : skeletonPulse}
      animate={prefersReducedMotion ? undefined : 'animate'}
    />
  );
};

export const SkeletonCircle: React.FC<Omit<SkeletonProps, 'circle' | 'borderRadius'>> = (props) => (
  <SkeletonBlock {...props} circle={true} />
);

interface SkeletonTextProps extends Omit<SkeletonProps, 'circle'> {
  lines?: number;
  lineHeight?: string | number;
  gap?: string | number;
}

export const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 1,
  lineHeight = '1em',
  gap = '0.5em',
  className = '',
  width,
  ...props
}) => {
  if (lines === 1) {
    return <SkeletonBlock className={`skeleton-text ${className}`} height={lineHeight} width={width || '100%'} {...props} />;
  }

  return (
    <div className="skeleton-text-wrapper" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          className={`skeleton-text ${className}`}
          height={lineHeight}
          width={i === lines - 1 && lines > 1 ? '70%' : width || '100%'}
          {...props}
        />
      ))}
    </div>
  );
};

export const TableSkeleton: React.FC<{ columns?: number; rows?: number }> = ({
  columns = 4,
  rows = 5,
}) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={`table-skeleton-row-${rowIndex}`} className="data-table-row">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={`table-skeleton-col-${colIndex}`}>
              <SkeletonText
                width={colIndex === 0 ? "80%" : colIndex === columns - 1 ? "100%" : "50%"}
                lineHeight="1.2em"
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};

export const DashboardCardSkeleton: React.FC = () => {
  return (
    <div
      className="glass-panel"
      style={{
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        background: "var(--bg-muted)",
      }}
      aria-hidden="true"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <SkeletonCircle width={20} height={20} />
        <SkeletonText width="120px" lineHeight="1.1rem" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <SkeletonText width="80px" lineHeight="0.8rem" />
        <SkeletonText width="100%" lineHeight="0.9rem" lines={2} />
      </div>
      <div className="flex gap-md" style={{ marginTop: "14px", flexWrap: "wrap" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: "1 1 150px",
              padding: "10px 12px",
              borderRadius: "10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border-glass)",
            }}
          >
            <SkeletonText width="60%" lineHeight="0.75rem" style={{ marginBottom: "8px" }} />
            <SkeletonText width="80%" lineHeight="1rem" />
            <SkeletonText width="40%" lineHeight="0.8rem" />
          </div>
        ))}
      </div>
      <div style={{ marginTop: "12px" }}>
        <SkeletonText width="40%" lineHeight="0.82rem" />
      </div>
    </div>
  );
};

export const ChartSkeleton: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
      aria-hidden="true"
    >
      <div className="flex justify-between items-start">
        <div style={{ width: "40%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <SkeletonCircle width={18} height={18} />
            <SkeletonText width="120px" lineHeight="1.1rem" />
          </div>
          <SkeletonText width="180px" lineHeight="0.82rem" />
        </div>
        <SkeletonBlock width="140px" height="32px" borderRadius="8px" />
      </div>
      <SkeletonBlock width="100%" height="260px" borderRadius="var(--radius-sm)" />
    </div>
  );
};

export const SharePriceSkeleton: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: "6px" }} aria-hidden="true">
    <SkeletonCircle width={16} height={16} />
    <SkeletonText width="80px" lineHeight="1rem" />
  </div>
);

export const VaultStatSkeleton: React.FC = () => (
  <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    <SkeletonText width="60%" lineHeight="0.75rem" />
    <SkeletonBlock width="120px" height="1.5rem" borderRadius="var(--radius-sm)" />
  </div>
);

export const TransactionRowSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="data-table-row"
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 0",
      gap: "12px",
    }}
  >
    <div style={{ flex: 2 }}>
      <SkeletonText width="70%" lineHeight="1rem" />
      <SkeletonText width="40%" lineHeight="0.75rem" style={{ marginTop: "4px" }} />
    </div>
    <div style={{ flex: 1, textAlign: "right" }}>
      <SkeletonBlock width="80px" height="1rem" borderRadius="var(--radius-sm)" />
    </div>
    <div style={{ flex: 1, textAlign: "right" }}>
      <SkeletonBlock width="60px" height="22px" borderRadius="99px" />
    </div>
  </div>
);

export const PortfolioCardSkeleton: React.FC = () => (
  <div className="glass-panel" style={{ padding: "20px" }} aria-hidden="true">
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <SkeletonCircle width={32} height={32} />
        <div>
          <SkeletonText width="100px" lineHeight="1rem" />
          <SkeletonText width="60px" lineHeight="0.75rem" style={{ marginTop: "4px" }} />
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <SkeletonText width="80px" lineHeight="1rem" />
        <SkeletonText width="50px" lineHeight="0.75rem" style={{ marginTop: "4px" }} />
      </div>
    </div>
    <div
      style={{
        height: "1px",
        background: "var(--border-glass)",
        marginBottom: "12px",
      }}
    />
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <SkeletonText width="50%" lineHeight="0.8rem" />
      <SkeletonText width="30%" lineHeight="0.8rem" />
    </div>
  </div>
);

export const AnalyticsWidgetSkeleton: React.FC = () => (
  <div className="glass-panel" style={{ padding: "20px" }} aria-hidden="true">
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
      <SkeletonCircle width={18} height={18} />
      <SkeletonText width="140px" lineHeight="1rem" />
    </div>
    <SkeletonBlock width="100%" height="48px" borderRadius="var(--radius-sm)" style={{ marginBottom: "12px" }} />
    <SkeletonText width="80%" lineHeight="0.75rem" />
    <SkeletonText width="50%" lineHeight="0.75rem" style={{ marginTop: "6px" }} />
  </div>
);

// Default export for backward compatibility
export default SkeletonBlock;
