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
import "./index.css";

import * as Sentry from "@sentry/react";
import { useTranslation } from "./i18n";
import { useUsdcBalance } from "./hooks/useBalanceData";

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
  const { data: usdcBalance = 0 } = useUsdcBalance(walletAddress);

  const handleConnect = async (address: string) => {
    setWalletAddress(address);
  };

  const handleDisconnect = () => {
    setWalletAddress(null);
  };

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
                element={
                  <Portfolio
                    walletAddress={walletAddress}
                    usdcBalance={usdcBalance}
                  />
                }
              />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<div>Settings Page</div>} />
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
      <ThemeProvider>
        <VaultProvider>
          <Router>
            <AppContent />
          </Router>
        </VaultProvider>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
