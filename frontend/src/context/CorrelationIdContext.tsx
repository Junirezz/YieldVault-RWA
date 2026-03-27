import React, { createContext, useCallback, useContext, useState } from 'react';

export interface CorrelationIdContextValue {
  correlationId: string;
  /** Replace the active ID (e.g. when starting a new user action). */
  refreshCorrelationId: () => void;
}

const CorrelationIdContext = createContext<CorrelationIdContextValue | undefined>(undefined);

export const CorrelationIdProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [correlationId, setCorrelationId] = useState<string>(() => crypto.randomUUID());

  const refreshCorrelationId = useCallback(() => {
    setCorrelationId(crypto.randomUUID());
  }, []);

  return (
    <CorrelationIdContext.Provider value={{ correlationId, refreshCorrelationId }}>
      {children}
    </CorrelationIdContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useCorrelationId(): CorrelationIdContextValue {
  const context = useContext(CorrelationIdContext);
  if (!context) {
    throw new Error('useCorrelationId must be used within a CorrelationIdProvider');
  }
  return context;
}
