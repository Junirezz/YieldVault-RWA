import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./components/Navbar";
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
    setUsdcBalance(0);
  };

  const handleNavigate = (path: AppPath) => {
    if (location.pathname !== path) {
      navigate(path);
    }
  };

  return (
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
