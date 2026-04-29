import React from "react";
import "./EmptyState.css";

export interface EmptyStateProps {
  /** Heading text shown below the icon */
  title: string;
  /** Supporting copy shown below the title */
  description: string;
  /** Icon or SVG node rendered inside the icon circle */
  icon: React.ReactNode;
  /** Label for the optional call-to-action button */
  actionLabel?: string;
  /** Callback fired when the CTA button is clicked */
  onAction?: () => void;
  /**
   * Visual variant:
   * - `"default"` — solid muted background with border (used for primary empty states)
   * - `"minimal"` — transparent with dashed border (used for secondary / coming-soon states)
   */
  variant?: "default" | "minimal";
  /** Optional extra class names forwarded to the root element */
  className?: string;
}

/**
 * EmptyState
 *
 * Center-aligned placeholder shown when a page or section has no data to
 * display. Renders after the initial loading sequence completes so it never
 * flickers in before data arrives.
 *
 * Usage:
 * ```tsx
 * {!isLoading && totalValue === 0 && (
 *   <EmptyState
 *     title="Your portfolio is empty."
 *     description="Once you deposit, you'll be able to track your assets here."
 *     icon={<Briefcase size={40} />}
 *     actionLabel="Deposit Now"
 *     onAction={() => navigate("/")}
 *   />
 * )}
 * ```
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  variant = "default",
  className = "",
}) => {
  return (
    <div
      className={`empty-state-container empty-state-${variant} ${className}`.trim()}
      role="status"
      aria-label={title}
    >
      <div className="empty-state-icon-wrapper" aria-hidden="true">
        {React.isValidElement(icon)
          ? React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 40 })
          : icon}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          className="btn btn-primary empty-state-action"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
