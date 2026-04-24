import { lazy, Suspense, useCallback, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import Navbar from "./components/Navbar";
import SessionExpiredModal from "./components/SessionExpiredModal";
import type { DisconnectReason } from "./components/WalletConnect";
import { KeyboardShortcutProvider } from "./context/KeyboardShortcutContext";
import ShortcutHelpModal from "./components/ShortcutHelpModal";
import { FeatureGate } from "./components/FeatureGate";
import { FeatureFlagProvider } from "./context/FeatureFlagContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useTranslation } from "./i18n";
import { useUsdcBalance } from "./hooks/useBalanceData";
import { queryClient } from "./lib/queryClient";
import { clearWalletSessionState } from "./lib/sessionCleanup";
import ErrorFallback from "./components/ErrorFallback";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

const Home = lazy(() => import("./pages/Home"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Analytics = lazy(() => import("./pages/Analytics"));
const UIPreview = lazy(() => import("./pages/UIPreview"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory"));
const Settings = lazy(() => import("./pages/Settings"));
const LoadingPage = () => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "60vh",
        color: "var(--accent-cyan)",
        fontSize: "1.2rem",
        fontWeight: 500,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          className="text-gradient"
          style={{ fontSize: "2rem", marginBottom: "16px" }}
        >
          {t("app.loading.title")}
        </div>
        <div style={{ opacity: 0.6 }}>{t("app.loading.subtitle")}</div>
      </div>
    </div>
  );
};

// Removed simple fallback in favor of components/ErrorFallback

function AppContent() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionState, intendedPath, setSessionExpired, clearSessionExpired } = useAuth();
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

  return (
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
          <Suspense fallback={<LoadingPage />}>
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
        <ShortcutHelpModal />
        {sessionState === "expired" && (
          <SessionExpiredModal
            intendedPath={intendedPath}
            onReconnect={handleReconnect}
            onDismiss={() => handleDisconnect("manual")}
          />
        )}
      </div>
    </KeyboardShortcutProvider>
  );
}

function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={(props) => <ErrorFallback {...props} />}
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
