import React from 'react';
import { Activity } from './icons';
import { useTranslation } from '../i18n';

export interface TimelineEvent {
  id: string;
  timestamp: Date | string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  metadata?: Record<string, string | number>;
  type?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

export interface TimelineProps {
  events: TimelineEvent[];
  isLoading?: boolean;
  emptyMessage?: string;
  groupByDate?: boolean;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isToday(date: Date): boolean {
  const today = new Date();
  return getDateKey(date) === getDateKey(today);
}

function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return getDateKey(date) === getDateKey(yesterday);
}

function getDateLabel(date: Date, t: (key: string) => string): string {
  if (isToday(date)) return t('timeline.today');
  if (isYesterday(date)) return t('timeline.yesterday');
  return formatDate(date);
}

const typeColors: Record<string, { line: string; dot: string }> = {
  default: { line: 'var(--border-glass)', dot: 'var(--text-secondary)' },
  success: { line: 'rgba(34, 197, 94, 0.3)', dot: '#22c55e' },
  warning: { line: 'rgba(245, 158, 11, 0.3)', dot: '#f59e0b' },
  error: { line: 'rgba(239, 68, 68, 0.3)', dot: '#ef4444' },
  info: { line: 'rgba(59, 130, 246, 0.3)', dot: '#3b82f6' },
};

const TimelineItem: React.FC<{
  event: TimelineEvent;
  isLast: boolean;
}> = ({ event, isLast }) => {
  const eventDate = typeof event.timestamp === 'string'
    ? new Date(event.timestamp)
    : event.timestamp;
  const colors = typeColors[event.type || 'default'];

  return (
    <div
      style={{
        display: 'flex',
        gap: '16px',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'var(--bg-surface)',
            border: `2px solid ${colors.dot}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.dot,
            zIndex: 1,
          }}
        >
          {event.icon || <Activity size={14} />}
        </div>
        {!isLast && (
          <div
            style={{
              width: '2px',
              flex: 1,
              minHeight: '24px',
              background: colors.line,
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, paddingBottom: isLast ? 0 : '24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '12px',
            marginBottom: '4px',
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontSize: 'var(--text-base)',
            }}
          >
            {event.title}
          </span>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-tertiary)',
            }}
          >
            {formatTime(eventDate)}
          </span>
        </div>

        {event.description && (
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              marginBottom: event.metadata ? '8px' : 0,
            }}
          >
            {event.description}
          </p>
        )}

        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '8px',
            }}
          >
            {Object.entries(event.metadata).map(([key, value]) => (
              <span
                key={key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  background: 'var(--bg-muted)',
                  borderRadius: '4px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ fontWeight: 500 }}>{key}:</span>
                <span>{value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Timeline: React.FC<TimelineProps> = ({
  events,
  isLoading = false,
  emptyMessage,
  groupByDate = true,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div
        style={{
          padding: '48px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid var(--border-glass)',
            borderTopColor: 'var(--accent-cyan)',
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'spin 1s linear infinite',
          }}
        />
        {t('timeline.loading')}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        style={{
          padding: '48px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <Activity
          size={32}
          style={{ marginBottom: '12px', opacity: 0.5 }}
        />
        <p>{emptyMessage || t('timeline.empty')}</p>
      </div>
    );
  }

  const sortedEvents = [...events].sort((a, b) => {
    const dateA = typeof a.timestamp === 'string' ? new Date(a.timestamp) : a.timestamp;
    const dateB = typeof b.timestamp === 'string' ? new Date(b.timestamp) : b.timestamp;
    return dateB.getTime() - dateA.getTime();
  });

  if (!groupByDate) {
    return (
      <div style={{ padding: '16px 0' }}>
        {sortedEvents.map((event, index) => (
          <TimelineItem
            key={event.id}
            event={event}
            isLast={index === sortedEvents.length - 1}
          />
        ))}
      </div>
    );
  }

  const groupedEvents: Record<string, TimelineEvent[]> = {};
  for (const event of sortedEvents) {
    const eventDate = typeof event.timestamp === 'string'
      ? new Date(event.timestamp)
      : event.timestamp;
    const key = getDateKey(eventDate);
    if (!groupedEvents[key]) groupedEvents[key] = [];
    groupedEvents[key].push(event);
  }

  return (
    <div style={{ padding: '16px 0' }}>
      {Object.entries(groupedEvents).map(([dateKey, dateEvents]) => {
        const date = new Date(dateKey);
        return (
          <div key={dateKey} style={{ marginBottom: '32px' }}>
            <h3
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '16px',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--border-glass)',
              }}
            >
              {getDateLabel(date, t)}
            </h3>
            {dateEvents.map((event, index) => (
              <TimelineItem
                key={event.id}
                event={event}
                isLast={index === dateEvents.length - 1}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default Timeline;
