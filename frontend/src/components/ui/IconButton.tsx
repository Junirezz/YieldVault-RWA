import React from "react";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: { padding: "4px", minWidth: "24px", minHeight: "24px" },
  md: { padding: "8px", minWidth: "32px", minHeight: "32px" },
  lg: { padding: "12px", minWidth: "40px", minHeight: "40px" },
};

const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    background: "var(--bg-muted)",
    border: "1px solid var(--border-glass)",
    color: "var(--text-primary)",
  },
  ghost: {
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
  },
  danger: {
    background: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#ef4444",
  },
};

const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  variant = "default",
  size = "md",
  style,
  ...rest
}) => {
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        transition: "all 0.2s",
        lineHeight: 1,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = "0.85";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
      }}
      {...rest}
    >
      {icon}
    </button>
  );
};

export default IconButton;
