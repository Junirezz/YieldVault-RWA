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
  clearPersistedWalletAddress,
  getPersistedWalletAddress,
  setPersistedWalletAddress,
} from "./lib/walletSession";
import {
  clearVaultFormDraft,
  hasMeaningfulDraft,
  loadVaultFormDraft,
  type VaultFormDraft,
} from "./lib/formDraftStorage";
import ErrorBoundary from "./components/ErrorBoundary";
import ErrorFallback from "./components/ErrorFallback";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import RouteLoadingFallback from "./components/RouteLoadingFallback";
import { captureException } from "./config/sentry";
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
import { useRestoreGuardedRoute } from "./hooks/useRestoreGuardedRoute";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

const TransactionReceipt = lazy(() => import("./pages/TransactionReceipt"));
const StrategyDetail = lazy(() => import("./pages/StrategyDetail"));
const Admin = lazy(() => import("./pages/Admin"));
const VaultHealthDashboard = lazy(() => import("./pages/VaultHealthDashboard"));
const AuditLog = lazy(() => import("./pages/AuditLog"));

// Removed simple fallback in favor of components/ErrorFallback

function AppContent() {
  const [walletAddress, setWalletAddress] = useState<string | null>(() =>
    getPersistedWalletAddress(),
  );
  const [pendingDraft, setPendingDraft] = useState<VaultFormDraft | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionState, intendedPath, setSessionExpired, clearSessionExpired, renewSession } = useAuth();
  usePageViewTracking();
  const { data: usdcBalance = 0 } = useUsdcBalance(walletAddress);
  const { data: xlmBalance = 0 } = useXlmBalance(walletAddress);
  const { tvl } = useVault();
  const role = useMemo(() => resolveUserRole(walletAddress), [walletAddress]);
  useRestoreGuardedRoute(role);

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
    setPersistedWalletAddress(address);
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
    clearPersistedWalletAddress();
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
                    <RouteErrorBoundary routeName="home">
                      <LazyHome
                        walletAddress={walletAddress}
                        usdcBalance={usdcBalance}
                        xlmBalance={xlmBalance}
                      />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/portfolio"
                  element={
                    <RouteErrorBoundary routeName="portfolio">
                      <LazyPortfolio walletAddress={walletAddress} />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <RouteErrorBoundary routeName="analytics">
                      <FeatureGate flag="ANALYTICS_PAGE">
                        <LazyAnalytics />
                      </FeatureGate>
                    </RouteErrorBoundary>
                  }
                />
                <Route path="/transactions" element={<ErrorBoundary><LazyTransactionHistory walletAddress={walletAddress} /></ErrorBoundary>} />
                <Route path="/compare" element={<ErrorBoundary><LazyVaultComparison /></ErrorBoundary>} />
                <Route path="/strategies/:strategyId" element={<ErrorBoundary><StrategyDetail walletAddress={walletAddress} /></ErrorBoundary>} />
                <Route path="/receipt/:txHash" element={<ErrorBoundary><TransactionReceipt /></ErrorBoundary>} />
                <Route path="/settings" element={<ErrorBoundary><LazySettings /></ErrorBoundary>} />
                <Route path="/vault-health" element={<ErrorBoundary><VaultHealthDashboard /></ErrorBoundary>} />
                <Route path="/audit-log" element={<ErrorBoundary><AuditLog /></ErrorBoundary>} />
                <Route path="/ui-kit" element={<ErrorBoundary><LazyUIPreview /></ErrorBoundary>} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute role={role} allow={["admin"]}>
                      <RouteErrorBoundary routeName="admin">
                        <Admin walletAddress={walletAddress} />
                      </RouteErrorBoundary>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/transactions"
                  element={
                    <RouteErrorBoundary routeName="transactions">
                      <LazyTransactionHistory walletAddress={walletAddress} />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/compare"
                  element={
                    <RouteErrorBoundary routeName="vault-comparison">
                      <LazyVaultComparison />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/strategies/:strategyId"
                  element={
                    <RouteErrorBoundary routeName="strategy-detail">
                      <StrategyDetail walletAddress={walletAddress} />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/receipt/:txHash"
                  element={
                    <RouteErrorBoundary routeName="transaction-receipt">
                      <TransactionReceipt />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RouteErrorBoundary routeName="settings">
                      <LazySettings />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/vault-health"
                  element={
                    <RouteErrorBoundary routeName="vault-health">
                      <VaultHealthDashboard />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/audit-log"
                  element={
                    <RouteErrorBoundary routeName="audit-log">
                      <AuditLog />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/ui-kit"
                  element={
                    <RouteErrorBoundary routeName="ui-preview">
                      <LazyUIPreview />
                    </RouteErrorBoundary>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute role={role} allow={["admin"]}>
                      <RouteErrorBoundary routeName="admin">
                        <Admin walletAddress={walletAddress} />
                      </RouteErrorBoundary>
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<ErrorBoundary><Navigate to="/" replace /></ErrorBoundary>} />
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
      <ErrorBoundary onError={(error) => captureException(error, { route: "app-root" })}>
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
