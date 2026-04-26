import { lazy, Suspense, useCallback, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import Navbar from "./components/Navbar";
import SessionExpiredModal from "./components/SessionExpiredModal";
import SessionExpiryWarning from "./components/SessionExpiryWarning";
import type { DisconnectReason } from "./components/WalletConnect";
import { KeyboardShortcutProvider } from "./context/KeyboardShortcutContext";
import ShortcutHelpModal from "./components/ShortcutHelpModal";
import OnboardingWalkthrough from "./components/OnboardingWalkthrough";
import { FeatureGate } from "./components/FeatureGate";
import { FeatureFlagProvider } from "./context/FeatureFlagContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useUsdcBalance } from "./hooks/useBalanceData";
import { queryClient } from "./lib/queryClient";
import { clearWalletSessionState } from "./lib/sessionCleanup";
import ErrorFallback from "./components/ErrorFallback";
import RouteLoadingFallback from "./components/RouteLoadingFallback";
import { PreferencesProvider } from "./context/PreferencesContext";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

const Home = lazy(() => import("./pages/Home"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Analytics = lazy(() => import("./pages/Analytics"));
const UIPreview = lazy(() => import("./pages/UIPreview"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory"));
const Settings = lazy(() => import("./pages/Settings"));

// Removed simple fallback in favor of components/ErrorFallback

function AppContent() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionState, intendedPath, setSessionExpired, clearSessionExpired, dismissSessionWarning } = useAuth();
  const { data: usdcBalance = 0 } = useUsdcBalance(walletAddress);

  const handleConnect = useCallback((address: string) => {
    clearSessionExpired();
    setWalletAddress(address);
  }, [clearSessionExpired]);

  const handleDisconnect = useCallback((reason: DisconnectReason = "manual") => {
    if (reason === "session-expired") {
      setSessionExpired(location.pathname);
    } else {
      clearSessionExpired();
    }

    clearWalletSessionState(queryClient);
    setWalletAddress(null);
    navigate("/", { replace: true });
  }, [clearSessionExpired, location.pathname, navigate, setSessionExpired]);

  const handleReconnect = useCallback(() => {
    clearSessionExpired();
    window.dispatchEvent(new Event("TRIGGER_WALLET_CONNECT"));
  }, [clearSessionExpired]);

  const handleDismissWarning = useCallback(() => {
    dismissSessionWarning();
  }, [dismissSessionWarning]);

  return (
    <PreferencesProvider walletAddress={walletAddress}>
      <KeyboardShortcutProvider>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <div className="app-container">
          <Navbar
            walletAddress={walletAddress}
            usdcBalance={usdcBalance}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
          <main id="main-content" className="container app-main" style={{ marginTop: "100px", paddingBottom: "60px" }}>
            <Suspense fallback={<RouteLoadingFallback />}>
              <SentryRoutes>
                <Route
                  path="/"
                  element={
                    <Home
                      walletAddress={walletAddress}
                      usdcBalance={usdcBalance}
                    />
                  }
                />
                <Route
                  path="/portfolio"
                  element={
                    <Portfolio
                      walletAddress={walletAddress}
                    />
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <FeatureGate flag="ANALYTICS_PAGE">
                      <Analytics />
                    </FeatureGate>
                  }
                />
                <Route path="/transactions" element={<TransactionHistory walletAddress={walletAddress} />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/ui-kit" element={<UIPreview />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </SentryRoutes>
            </Suspense>
          </main>
          <OnboardingWalkthrough />
          <ShortcutHelpModal />
          {sessionState === "warning" && walletAddress && (
            <SessionExpiryWarning
              onReconnect={handleReconnect}
              onDismiss={handleDismissWarning}
            />
          )}
          {sessionState === "expired" && (
            <SessionExpiredModal
              intendedPath={intendedPath}
              onReconnect={handleReconnect}
              onDismiss={() => handleDisconnect("manual")}
            />
          )}
        </div>
      </KeyboardShortcutProvider>
    </PreferencesProvider>
  );
}

function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={(props) => (
        <ErrorFallback
          error={(props.error instanceof Error ? props.error : new Error(String(props.error)))}
          resetError={props.resetError}
        />
      )}
      showDialog
    >
      <AuthProvider>
        <FeatureFlagProvider>
          <AppContent />
        </FeatureFlagProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
