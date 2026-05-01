import React from "react";
import type { ReactNode } from "react";
import { PackageSearch } from "../icons";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  ctaLabel: string;
  onAction: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon = <PackageSearch />,
  ctaLabel,
  onAction,
}) => {
  return (
    <div 
      className="flex flex-col items-center justify-center p-xl text-center glass-panel w-full" 
      style={{ 
        background: "var(--bg-muted)",
        border: "1px dashed var(--border-glass)",
        borderRadius: "var(--radius-xl)",
        margin: "var(--space-6) 0",
        boxSizing: "border-box"
      }}
    >
      <div 
        className="flex items-center justify-center mb-6"
        style={{ 
          width: "80px", 
          height: "80px", 
          borderRadius: "50%", 
          background: "var(--accent-cyan-dim)", 
          color: "var(--accent-cyan)",
          border: "1px solid rgba(0, 240, 255, 0.2)",
          boxShadow: "var(--shadow-glow)"
        }}
      >
        {React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 40 })}
      </div>
      <h3 className="text-2xl mb-3 text-primary">{title}</h3>
      <p 
        className="text-secondary mb-8 leading-relaxed"
        style={{ maxWidth: "420px" }}
      >
        {description}
      </p>
      <button 
        className="btn btn-primary px-8 py-3 text-md" 
        onClick={onAction}
        style={{ minWidth: "200px" }}
      >
        {ctaLabel}
      </button>
    </div>
  );
};

export default EmptyState;
