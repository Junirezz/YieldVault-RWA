import { useEffect, useState, lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { VaultProvider } from "./context/VaultContext";
import { KeyboardShortcutProvider } from "./context/KeyboardShortcutContext";
import Navbar from "./components/Navbar";
import ShortcutHelpModal from "./components/ShortcutHelpModal";
import { FeatureGate } from "./components/FeatureGate";
import { FeatureFlagProvider } from "./context/FeatureFlagContext";
import "./index.css";

import * as Sentry from "@sentry/react";
import { fetchUsdcBalance } from "./lib/stellarAccount";
import { useTranslation } from "./i18n";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

const Home = lazy(() => import("./pages/Home"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Analytics = lazy(() => import("./pages/Analytics"));

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

const AppErrorFallback = () => {
  const { t } = useTranslation();
  return <p>{t("app.errorBoundary")}</p>;
};

function AppContent() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState(0);

  const handleConnect = async (address: string) => {
    setWalletAddress(address);
  };

  const handleDisconnect = () => {
    setWalletAddress(null);
    setUsdcBalance(0);
  };

  useEffect(() => {
    const loadBalance = async () => {
      if (!walletAddress) {
        setUsdcBalance(0);
        return;
      }

      try {
        const discoveredBalance = await fetchUsdcBalance(walletAddress);
        setUsdcBalance(discoveredBalance);
      } catch {
        setUsdcBalance(0);
      }
    };

    loadBalance();
  }, [walletAddress]);

  return (
    <KeyboardShortcutProvider>
      <div className="app-container">
        <Navbar
          walletAddress={walletAddress}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
        <main
          className="container"
          style={{ marginTop: "100px", paddingBottom: "60px" }}
        >
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
                element={<Portfolio walletAddress={walletAddress} />}
              />
              <Route
                path="/analytics"
                element={
                  <FeatureGate flag="ANALYTICS_PAGE">
                    <Analytics />
                  </FeatureGate>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </SentryRoutes>
          </Suspense>
        </main>
        <ShortcutHelpModal />
      </div>
    </KeyboardShortcutProvider>
  );
}

function App() {
  return (
    <Sentry.ErrorBoundary fallback={<AppErrorFallback />} showDialog>
      <FeatureFlagProvider>
        <ThemeProvider>
          <VaultProvider>
            <Router>
              <AppContent />
            </Router>
          </VaultProvider>
        </ThemeProvider>
      </FeatureFlagProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
