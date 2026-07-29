import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from "react";

export type SessionState = "idle" | "warning" | "expired";

interface AuthContextType {
  sessionState: SessionState;
  intendedPath: string;
  timeRemainingMs: number;
  setSessionWarning: () => void;
  setSessionExpired: (path: string) => void;
  clearSessionExpired: () => void;
  dismissSessionWarning: () => void;
  renewSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_WINDOW_MS = 5 * 60 * 1000;
const SESSION_CHECK_INTERVAL_MS = 10_000;
const COUNTDOWN_INTERVAL_MS = 1_000;

function getSessionStart(): number | null {
  const raw = localStorage.getItem("wallet_session_start");
  if (!raw) return null;
  const val = parseInt(raw, 10);
  return Number.isFinite(val) ? val : null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [intendedPath, setIntendedPath] = useState("/");
  const [timeRemainingMs, setTimeRemainingMs] = useState(0);
  const warningHandledRef = useRef(false);

  const setSessionWarning = useCallback(() => {
    if (warningHandledRef.current) return;
    warningHandledRef.current = true;
    setSessionState("warning");
  }, []);

  const renewSession = useCallback(() => {
    localStorage.setItem("wallet_session_start", Date.now().toString());
    warningHandledRef.current = false;
    setSessionState("idle");
  }, []);

  useEffect(() => {
    const checkSession = () => {
      const sessionStart = getSessionStart();
      if (!sessionStart) return;

      const now = Date.now();
      const elapsed = now - sessionStart;
      const remaining = Math.max(0, SESSION_TIMEOUT_MS - elapsed);

      setTimeRemainingMs(remaining);

      if (elapsed >= SESSION_TIMEOUT_MS) {
        if (sessionState !== "expired") {
          setSessionState("expired");
        }
      } else if (remaining <= WARNING_WINDOW_MS && sessionState === "idle") {
        setSessionWarning();
      }
    };

    checkSession();
    const interval = setInterval(checkSession, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionState, setSessionWarning]);

  useEffect(() => {
    if (sessionState !== "warning") return;
    const countdown = setInterval(() => {
      const sessionStart = getSessionStart();
      if (!sessionStart) return;
      const remaining = Math.max(0, SESSION_TIMEOUT_MS - (Date.now() - sessionStart));
      setTimeRemainingMs(remaining);
      if (remaining <= 0) {
        setSessionState("expired");
      }
    }, COUNTDOWN_INTERVAL_MS);
    return () => clearInterval(countdown);
  }, [sessionState]);

  const setSessionExpired = useCallback((path: string) => {
    setSessionState((current) => {
      if (current === "expired") return current;
      setIntendedPath(path);
      return "expired";
    });
  }, []);

  const clearSessionExpired = useCallback(() => {
    setSessionState("idle");
    warningHandledRef.current = false;
  }, []);

  const dismissSessionWarning = useCallback(() => {
    // `warningHandledRef` stays set: the session is still inside the warning
    // window, so re-arming it would immediately re-raise the banner the user
    // just dismissed. Only renewing or clearing the session re-arms it.
    setSessionState("idle");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        sessionState,
        intendedPath,
        timeRemainingMs,
        setSessionWarning,
        setSessionExpired,
        clearSessionExpired,
        dismissSessionWarning,
        renewSession,
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
