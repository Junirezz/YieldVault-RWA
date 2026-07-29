import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import Navbar from "./components/Navbar";
import SessionExpiredModal from "./components/SessionExpiredModal";
import SessionExpiryWarning from "./components/SessionExpiryWarning";
import WalletDisconnectRecoveryModal from "./components/WalletDisconnectRecoveryModal";
import ToastCenter from "./components/ToastCenter";
import type { DisconnectReason } from "./components/WalletConnect";
import { KeyboardShortcutProvider } from "./context/KeyboardShortcutContext";
import ShortcutHelpModal from "./components/ShortcutHelpModal";
import CommandPalette from "./components/CommandPalette";
import OnboardingWalkthrough from "./components/OnboardingWalkthrough";
import { FeatureGate } from "./components/FeatureGate";
import { FeatureFlagProvider } from "./context/FeatureFlagContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { useUsdcBalance, useXlmBalance } from "./hooks/useBalanceData";
import { queryClient } from "./lib/queryClient";
import { clearWalletSessionState } from "./lib/sessionCleanup";
import {
  clearVaultFormDraft,
  hasMeaningfulDraft,
  loadVaultFormDraft,
  type VaultFormDraft,
} from "./lib/formDraftStorage";
import ErrorBoundary from "./components/ErrorBoundary";
import ErrorFallback from "./components/ErrorFallback";
import RouteLoadingFallback from "./components/RouteLoadingFallback";
import {
  LazyAnalytics,
  LazyHome,
  LazyPortfolio,
  LazySettings,
  LazyTransactionHistory,
  LazyUIPreview,
  LazyVaultComparison,
  prefetchDashboardRoutes,
} from "./lib/routePrefetch";
import NetworkWarningBanner from "./components/NetworkWarningBanner";
import OfflineBanner from "./components/OfflineBanner";
import HighLatencyBanner from "./components/HighLatencyBanner";
import { useVault, VaultProvider } from "./context/VaultContext";
import { usePageViewTracking } from "./hooks/useAnalytics";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { resolveUserRole } from "./lib/roles";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

const TransactionReceipt = lazy(() => import("./pages/TransactionReceipt"));
const Admin = lazy(() => import("./pages/Admin"));

// Removed simple fallback in favor of components/ErrorFallback

function AppContent() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<VaultFormDraft | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionState, intendedPath, setSessionExpired, clearSessionExpired, renewSession } = useAuth();
  usePageViewTracking();
  const { data: usdcBalance = 0 } = useUsdcBalance(walletAddress);
  const { data: xlmBalance = 0 } = useXlmBalance(walletAddress);
  const { tvl } = useVault();
  const role = useMemo(() => resolveUserRole(walletAddress), [walletAddress]);

  useEffect(() => {
    if ((window as Window & { Cypress?: unknown }).Cypress) {
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => console.log("[SW] Registered"))
        .catch((err) => console.error("[SW] Registration failed:", err));
    }
  }, []);

  useEffect(() => {
    const schedulePrefetch = () => prefetchDashboardRoutes(location.pathname);

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(schedulePrefetch, { timeout: 2500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = globalThis.setTimeout(schedulePrefetch, 1500);
    return () => globalThis.clearTimeout(timeoutId);
  }, [location.pathname]);

  const handleConnect = useCallback((address: string) => {
    renewSession();
    clearSessionExpired();
    setWalletAddress(address);
    setPendingDraft(null);
  }, [renewSession, clearSessionExpired]);

  const handleDisconnect = useCallback((reason: DisconnectReason = "manual") => {
    if (reason === "session-expired") {
      setSessionExpired(location.pathname);
    } else {
      clearSessionExpired();
    }

    if (reason === "manual") {
      clearVaultFormDraft();
      setPendingDraft(null);
    } else {
      const draft = loadVaultFormDraft();
      if (hasMeaningfulDraft(draft)) {
        setPendingDraft(draft);
      } else {
        clearVaultFormDraft();
        setPendingDraft(null);
      }
    }

    clearWalletSessionState(queryClient);
    setWalletAddress(null);
    navigate("/", { replace: true });
  }, [clearSessionExpired, location.pathname, navigate, setSessionExpired]);

  const handleRestoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    const params = new URLSearchParams();
    params.set("tab", pendingDraft.tab);
    params.set("step", pendingDraft.step);
    if (pendingDraft.amount) {
      params.set("amount", pendingDraft.amount);
    }
    navigate(`/?${params.toString()}`, { replace: true });
    setPendingDraft(null);
  }, [navigate, pendingDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearVaultFormDraft();
    setPendingDraft(null);
  }, []);

  const handleReconnect = useCallback(() => {
    clearSessionExpired();
    window.dispatchEvent(new Event("TRIGGER_WALLET_CONNECT"));
  }, [clearSessionExpired]);

  return (
    <PreferencesProvider walletAddress={walletAddress}>
      <KeyboardShortcutProvider walletAddress={walletAddress}>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <OfflineBanner lastKnownTvl={tvl} lastKnownBalance={usdcBalance} />
        <div className="app-container">
          <NetworkWarningBanner walletAddress={walletAddress} />
          <HighLatencyBanner />
          <Navbar
            walletAddress={walletAddress}
            usdcBalance={usdcBalance}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            role={role}
          />
          <main id="main-content" className="container app-main" style={{ marginTop: "100px", paddingBottom: "60px" }}>
            <Suspense fallback={<RouteLoadingFallback />}>
              <SentryRoutes>
                <Route
                  path="/"
                  element={
                    <LazyHome
                      walletAddress={walletAddress}
                      usdcBalance={usdcBalance}
                      xlmBalance={xlmBalance}
                    />
                  }
                />
                <Route
                  path="/portfolio"
                  element={
                    <LazyPortfolio
                      walletAddress={walletAddress}
                    />
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <FeatureGate flag="ANALYTICS_PAGE">
                      <LazyAnalytics />
                    </FeatureGate>
                  }
                />
                <Route path="/transactions" element={<LazyTransactionHistory walletAddress={walletAddress} />} />
                <Route path="/compare" element={<LazyVaultComparison />} />
                <Route path="/receipt/:txHash" element={<TransactionReceipt />} />
                <Route path="/settings" element={<LazySettings />} />
                <Route path="/ui-kit" element={<LazyUIPreview />} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute role={role} allow={["admin"]}>
                      <Admin walletAddress={walletAddress} />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </SentryRoutes>
            </Suspense>
          </main>
          <OnboardingWalkthrough />
          <ShortcutHelpModal />
          <CommandPalette />
          {sessionState === "warning" && walletAddress && <SessionExpiryWarning />}
          {sessionState === "expired" && (
            <SessionExpiredModal
              intendedPath={intendedPath}
              onReconnect={handleReconnect}
              onDismiss={() => handleDisconnect("manual")}
            />
          )}
          {pendingDraft && !walletAddress && (
            <WalletDisconnectRecoveryModal
              draft={pendingDraft}
              onReconnect={handleReconnect}
              onRestore={handleRestoreDraft}
              onDiscard={handleDiscardDraft}
            />
          )}
          <ToastCenter />
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
      showDialog={false}
    >
      <ErrorBoundary>
        <AuthProvider>
          <FeatureFlagProvider>
            <VaultProvider>
              <AppContent />
            </VaultProvider>
          </FeatureFlagProvider>
        </AuthProvider>
      </ErrorBoundary>
    </Sentry.ErrorBoundary>
  );
}

export default App;
