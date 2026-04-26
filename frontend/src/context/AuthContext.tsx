import React, { createContext, useCallback, useContext, useState, useEffect } from "react";

export type SessionState = "idle" | "warning" | "expired";

interface AuthContextType {
  sessionState: SessionState;
  intendedPath: string;
  setSessionWarning: () => void;
  setSessionExpired: (path: string) => void;
  clearSessionExpired: () => void;
  dismissSessionWarning: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [intendedPath, setIntendedPath] = useState("/");

  // Check for session expiry on mount and periodically
  useEffect(() => {
    const checkSessionExpiry = () => {
      const sessionStart = localStorage.getItem("wallet_session_start");
      if (!sessionStart) return;

      const startTime = parseInt(sessionStart, 10);
      const now = Date.now();
      const sessionDuration = now - startTime;
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes
      const warningTime = 5 * 60 * 1000; // 5 minutes before expiry

      if (sessionDuration >= sessionTimeout) {
        setSessionState("expired");
      } else if (sessionDuration >= sessionTimeout - warningTime && sessionState === "idle") {
        setSessionState("warning");
      }
    };

    checkSessionExpiry();
    const interval = setInterval(checkSessionExpiry, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [sessionState]);

  const setSessionWarning = useCallback(() => {
    setSessionState("warning");
  }, []);

  const setSessionExpired = useCallback((path: string) => {
    // Guard against flipping to expired more than once per session
    setSessionState((current) => {
      if (current === "expired") return current;
      setIntendedPath(path);
      return "expired";
    });
  }, []);

  const clearSessionExpired = useCallback(() => {
    setSessionState("idle");
  }, []);

  const dismissSessionWarning = useCallback(() => {
    setSessionState("idle");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        sessionState,
        intendedPath,
        setSessionWarning,
        setSessionExpired,
        clearSessionExpired,
        dismissSessionWarning,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
