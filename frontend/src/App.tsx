import { useState, lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { VaultProvider } from "./context/VaultContext";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./components/Navbar";
import { useTranslation } from "./i18n";
import Home from "./pages/Home";
import Analytics from "./pages/Analytics";
import Portfolio from "./pages/Portfolio";
import { fetchUsdcBalance } from "./lib/stellarAccount";
import "./index.css";

type AppPath = "/" | "/analytics" | "/portfolio";

function App() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState(1250.5);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!walletAddress) {
      setUsdcBalance(0);
      return;
    }

function AppLoadingFallback() {
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
}

function AppErrorFallback() {
  const { t } = useTranslation();
  return <p>{t("app.errorBoundary")}</p>;
}
    let cancelled = false;

    const syncBalance = async () => {
      try {
        const balance = await fetchUsdcBalance(walletAddress);
        if (!cancelled) {
          setUsdcBalance(balance > 0 ? balance : 1250.5);
        }
      } catch {
        // Keep the optimistic mock balance when live lookup is unavailable.
      }
    };

    void syncBalance();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const handleConnect = (address: string) => {
    setWalletAddress(address);
    setUsdcBalance((currentBalance) => (currentBalance > 0 ? currentBalance : 1250.5));
  };

  const handleDisconnect = () => {
    setWalletAddress(null);
  };

  const handleNavigate = (path: AppPath) => {
    if (location.pathname !== path) {
      navigate(path);
    }
  };

  return (
    <Sentry.ErrorBoundary fallback={<AppErrorFallback />} showDialog>
      <ThemeProvider>
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
                    {/* Replaced Routes with SentryRoutes to capture performance events */}
                    <SentryRoutes>
                      <Route
                        path="/"
                        element={<Home walletAddress={walletAddress} usdcBalance={usdcBalance} />}
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
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </SentryRoutes>
                  </Suspense>
                </main>
              </div>
            </Router>
          </VaultProvider>
        </ToastProvider>
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
                <Suspense fallback={<AppLoadingFallback />}>
                  {/* Replaced Routes with SentryRoutes to capture performance events */}
                  <SentryRoutes>
                    <Route
                      path="/"
                      element={<Home walletAddress={walletAddress} />}
                    />
                    <Route
                      path="/portfolio"
                      element={<Portfolio walletAddress={walletAddress} />}
                    />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </SentryRoutes>
                </Suspense>
              </main>
            </div>
          </Router>
        </VaultProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback error={error} resetError={resetError} />
      )}
      showDialog
    >
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
    <div className="app-container">
      <Navbar
        currentPath={location.pathname === "/portfolio" ? "/portfolio" : location.pathname === "/analytics" ? "/analytics" : "/"}
        onNavigate={handleNavigate}
        walletAddress={walletAddress}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      <main className="container" style={{ marginTop: "100px", paddingBottom: "60px" }}>
        <Routes>
          <Route path="/" element={<Home walletAddress={walletAddress} usdcBalance={usdcBalance} />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/portfolio" element={<Portfolio walletAddress={walletAddress} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
