import { useEffect, useState, lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { ToastProvider } from "./context/ToastContext";
import { VaultProvider } from "./context/VaultContext";
import { CorrelationIdProvider } from "./context/CorrelationIdContext";
import { CorrelationIdSync } from "./components/CorrelationIdSync";
import Navbar from "./components/Navbar";
import "./index.css";

import * as Sentry from "@sentry/react";
import { fetchUsdcBalance } from "./lib/stellarAccount";
import ErrorFallback from "./components/ErrorFallback";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

// Lazy load route components for code splitting
const Home = lazy(() => import("./pages/Home"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Analytics = lazy(() => import("./pages/Analytics"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory"));
const Settings = lazy(() => import("./pages/Settings"));

// Loading component for Suspense fallback
const LoadingPage = () => (
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
        Loading...
      </div>
      <div style={{ opacity: 0.6 }}>Securing RWA connection</div>
    </div>
  </div>
);

function App() {
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
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback error={error as Error} resetError={resetError} />
      )}
      showDialog
    >
      <PreferencesProvider>
      <ThemeProvider>
        <CorrelationIdProvider>
          <CorrelationIdSync />
          <ToastProvider>
            <VaultProvider>
              <Router>
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
                        <Route path="/analytics" element={<Analytics />} />
                        <Route
                          path="/transactions"
                          element={
                            <TransactionHistory walletAddress={walletAddress} />
                          }
                        />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </SentryRoutes>
                    </Suspense>
                  </main>
                </div>
              </Router>
            </VaultProvider>
          </ToastProvider>
        </CorrelationIdProvider>
      </ThemeProvider>
      </PreferencesProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
