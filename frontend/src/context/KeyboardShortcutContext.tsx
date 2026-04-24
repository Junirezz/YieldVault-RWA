import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts, formatShortcut } from '../hooks/useKeyboardShortcuts';
import type { ShortcutDefinition } from '../hooks/useKeyboardShortcuts';

interface KeyboardShortcutContextValue {
  shortcuts: ShortcutDefinition[];
  isHelpModalOpen: boolean;
  openHelpModal: () => void;
  closeHelpModal: () => void;
  formatShortcut: typeof formatShortcut;
}

const KeyboardShortcutContext = createContext<KeyboardShortcutContextValue | null>(null);

interface KeyboardShortcutProviderProps {
  children: React.ReactNode;
}

export const KeyboardShortcutProvider: React.FC<KeyboardShortcutProviderProps> = ({ children }) => {
  const navigate = useNavigate();
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const openHelpModal = useCallback(() => {
    setIsHelpModalOpen(true);
  }, []);

  const closeHelpModal = useCallback(() => {
    setIsHelpModalOpen(false);
  }, []);

  const shortcuts = useMemo<ShortcutDefinition[]>(() => [
    // ── Navigation (single-letter, Gmail/GitHub style) ──
    {
      key: 'g',
      action: () => navigate('/'),
      description: 'Go to Vaults',
      scope: 'Navigation'
    },
    {
      key: 'p',
      action: () => navigate('/portfolio'),
      description: 'Go to Portfolio',
      scope: 'Navigation'
    },
    {
      key: 'a',
      action: () => navigate('/analytics'),
      description: 'Go to Analytics',
      scope: 'Navigation'
    },
    {
      key: 't',
      action: () => navigate('/transactions'),
      description: 'Go to Transactions',
      scope: 'Navigation'
    },
    // ── Actions (single-letter, no browser clashes) ──
    {
      key: 'd',
      action: () => {
        navigate('/');
        setTimeout(() => window.dispatchEvent(new CustomEvent('TRIGGER_DEPOSIT')), 100);
      },
      description: 'Open Deposit Form',
      scope: 'Actions'
    },
    {
      key: 'w',
      action: () => window.dispatchEvent(new CustomEvent('TRIGGER_WALLET_CONNECT')),
      description: 'Connect Wallet',
      scope: 'Actions'
    },
    {
      key: 's',
      action: () => navigate('/settings'),
      description: 'Open Settings',
      scope: 'Actions'
    },
    // ── General ──
    {
      key: '?',
      shiftKey: true,
      action: openHelpModal,
      description: 'Show keyboard shortcuts',
      scope: 'General'
    },
    {
      key: 'Escape',
      action: closeHelpModal,
      description: 'Close modal',
      scope: 'General'
    }
  ], [navigate, openHelpModal, closeHelpModal]);

  useKeyboardShortcuts(shortcuts, true);

  const contextValue = useMemo<KeyboardShortcutContextValue>(() => ({
    shortcuts,
    isHelpModalOpen,
    openHelpModal,
    closeHelpModal,
    formatShortcut
  }), [shortcuts, isHelpModalOpen, openHelpModal, closeHelpModal]);

  return (
    <KeyboardShortcutContext.Provider value={contextValue}>
      {children}
    </KeyboardShortcutContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useKeyboardShortcutContext(): KeyboardShortcutContextValue {
  const context = useContext(KeyboardShortcutContext);
  if (!context) {
    throw new Error('useKeyboardShortcutContext must be used within KeyboardShortcutProvider');
  }
  return context;
}
