import React, { useSyncExternalStore, useCallback } from 'react';
import { useTranslation } from '../i18n';

interface RefreshControlProps {
  isPolling: boolean;
  isPaused: boolean;
  pauseReason: 'hidden' | 'offline' | 'manual' | null;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
  isRefetching?: boolean;
  lastUpdated?: Date | null;
}

function subscribeToTime(callback: () => void): () => void {
  const interval = setInterval(callback, 30000);
  return () => clearInterval(interval);
}

function useRelativeTime(date: Date | null | undefined, t: (key: string) => string): string {
  const getSnapshot = useCallback(() => {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return t('refresh.justNow');
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return t('refresh.oneMinuteAgo');
    return `${minutes} ${t('refresh.minutesAgo')}`;
  }, [date, t]);

  return useSyncExternalStore(subscribeToTime, getSnapshot, getSnapshot);
}

const RefreshControl: React.FC<RefreshControlProps> = ({
  isPolling,
  isPaused,
  pauseReason,
  onPause,
  onResume,
  onRefresh,
  isRefetching = false,
  lastUpdated,
}) => {
  const { t } = useTranslation();
  const lastUpdatedText = useRelativeTime(lastUpdated, t);

  const getPauseReasonText = (): string => {
    switch (pauseReason) {
      case 'hidden':
        return t('refresh.pausedHidden');
      case 'offline':
        return t('refresh.pausedOffline');
      case 'manual':
        return t('refresh.pausedManual');
      default:
        return '';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 12px',
        background: 'var(--bg-card)',
        borderRadius: '8px',
        fontSize: 'var(--text-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isPolling
              ? 'var(--accent-green, #22c55e)'
              : isPaused
              ? 'var(--accent-yellow, #eab308)'
              : 'var(--text-secondary)',
          }}
        />
        <span style={{ color: 'var(--text-secondary)' }}>
          {isPolling
            ? t('refresh.live')
            : isPaused
            ? getPauseReasonText()
            : t('refresh.stopped')}
        </span>
      </div>

      {lastUpdatedText && (
        <span style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
          {lastUpdatedText}
        </span>
      )}

      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
        {isPolling ? (
          <button
            aria-label={t('refresh.pause')}
            onClick={onPause}
            style={{
              padding: '4px 12px',
              background: 'transparent',
              border: '1px solid var(--border-glass)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
            }}
          >
            {t('refresh.pause')}
          </button>
        ) : isPaused && pauseReason === 'manual' ? (
          <button
            aria-label={t('refresh.resume')}
            onClick={onResume}
            style={{
              padding: '4px 12px',
              background: 'var(--accent-cyan)',
              border: 'none',
              borderRadius: '6px',
              color: '#000',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
            }}
          >
            {t('refresh.resume')}
          </button>
        ) : null}

        <button
          aria-label={isRefetching ? t('refresh.refreshing') : t('refresh.refreshNow')}
          onClick={onRefresh}
          disabled={isRefetching}
          style={{
            padding: '4px 12px',
            background: 'transparent',
            border: '1px solid var(--border-glass)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            cursor: isRefetching ? 'not-allowed' : 'pointer',
            fontSize: 'var(--text-sm)',
            opacity: isRefetching ? 0.6 : 1,
          }}
        >
          {isRefetching ? t('refresh.refreshing') : t('refresh.refreshNow')}
        </button>
      </div>
    </div>
  );
};

export default RefreshControl;
