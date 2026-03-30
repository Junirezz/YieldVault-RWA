import React from 'react';

export type BadgeVariant = 'default' | 'status' | 'outline' | 'pill';
export type BadgeColor = 'default' | 'cyan' | 'purple' | 'success' | 'warning' | 'error' | 'info';
export type BadgeSize = 'compact' | 'default';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  color?: BadgeColor;
  size?: BadgeSize;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const colorStyles: Record<BadgeColor, { bg: string; text: string; border: string }> = {
  default: {
    bg: 'rgba(148, 163, 184, 0.1)',
    text: 'var(--text-secondary)',
    border: 'rgba(148, 163, 184, 0.3)',
  },
  cyan: {
    bg: 'var(--accent-cyan-dim)',
    text: 'var(--accent-cyan)',
    border: 'rgba(0, 240, 255, 0.3)',
  },
  purple: {
    bg: 'rgba(112, 0, 255, 0.1)',
    text: '#a855f7',
    border: 'rgba(112, 0, 255, 0.3)',
  },
  success: {
    bg: 'rgba(34, 197, 94, 0.1)',
    text: '#22c55e',
    border: 'rgba(34, 197, 94, 0.3)',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.1)',
    text: '#f59e0b',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  error: {
    bg: 'var(--bg-error)',
    text: 'var(--text-error)',
    border: 'var(--border-error)',
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.1)',
    text: '#3b82f6',
    border: 'rgba(59, 130, 246, 0.3)',
  },
};

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  color = 'default',
  size = 'default',
  icon,
  className = '',
  style,
}) => {
  const colors = colorStyles[color];
  const isCompact = size === 'compact';

  const baseStyles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: isCompact ? '4px' : '6px',
    padding: isCompact ? '2px 6px' : '4px 10px',
    fontSize: isCompact ? 'var(--text-xs)' : 'var(--text-sm)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    lineHeight: 1.4,
  };

  const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    default: {
      background: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
    },
    status: {
      background: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontSize: 'var(--text-xs)',
    },
    outline: {
      background: 'transparent',
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
    },
    pill: {
      background: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: '9999px',
    },
  };

  return (
    <span
      className={className}
      style={{
        ...baseStyles,
        ...variantStyles[variant],
        ...style,
      }}
    >
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  );
};

export default Badge;
