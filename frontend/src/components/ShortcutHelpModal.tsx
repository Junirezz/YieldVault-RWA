import React, { useEffect, useRef } from 'react';
import { useKeyboardShortcutContext } from '../context/KeyboardShortcutContext';
import { useTranslation } from '../i18n';

const ShortcutHelpModal: React.FC = () => {
  const { shortcuts, isHelpModalOpen, closeHelpModal, formatShortcut } = useKeyboardShortcutContext();
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHelpModalOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isHelpModalOpen]);

  if (!isHelpModalOpen) return null;

  const groupedShortcuts = shortcuts.reduce<Record<string, typeof shortcuts>>((acc, shortcut) => {
    const scope = shortcut.scope || 'General';
    if (!acc[scope]) acc[scope] = [];
    acc[scope].push(shortcut);
    return acc;
  }, {});

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeHelpModal();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-glass)',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '480px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h2
            id="shortcut-help-title"
            style={{
              margin: 0,
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}
          >
            {t('shortcuts.title')}
          </h2>
          <button
            onClick={closeHelpModal}
            aria-label={t('shortcuts.close')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '24px',
              lineHeight: 1,
              padding: '4px'
            }}
          >
            &times;
          </button>
        </div>

        {Object.entries(groupedShortcuts).map(([scope, scopeShortcuts]) => (
          <div key={scope} style={{ marginBottom: '20px' }}>
            <h3 style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '12px'
            }}>
              {scope}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {scopeShortcuts.map((shortcut, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--bg-card)',
                    borderRadius: '8px'
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>
                    {shortcut.description}
                  </span>
                  <kbd style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'monospace',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '4px',
                    color: 'var(--accent-cyan)',
                    minWidth: '24px',
                    textAlign: 'center'
                  }}>
                    {formatShortcut(shortcut)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}

        <p style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          marginTop: '16px',
          marginBottom: 0
        }}>
          {t('shortcuts.hint')}
        </p>
      </div>
    </div>
  );
};

export default ShortcutHelpModal;
