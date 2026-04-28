import React, { useState, useEffect } from "react";
import { AlertTriangle, X } from "../icons";
import { networkConfig } from "../config/network";

interface NetworkWarningBannerProps {
  walletAddress: string | null;
  onDismiss?: () => void;
}

const NetworkWarningBanner: React.FC<NetworkWarningBannerProps> = ({
  walletAddress,
  onDismiss,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);

  useEffect(() => {
    if (!walletAddress) {
      setIsVisible(false);
      return;
    }

    // Check network when wallet connects
    const checkNetwork = async () => {
      try {
        // In a real implementation, this would check the actual network via Freighter API
        // For now, we'll simulate network detection
        const isTestnet = networkConfig.isTestnet;

        // Mock: assume wrong network initially, then correct after 2 seconds
        setIsWrongNetwork(true);
        setIsVisible(true);

        // Simulate network switch detection
        setTimeout(() => {
          setIsWrongNetwork(false);
          setIsVisible(false);
        }, 2000);
      } catch (error) {
        console.error("Network check failed:", error);
      }
    };

    checkNetwork();
  }, [walletAddress]);

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss?.();
  };

  if (!isVisible || !isWrongNetwork) {
    return null;
  }

  const expectedNetwork = networkConfig.isTestnet ? "Testnet" : "Mainnet";
  const currentNetwork = networkConfig.isTestnet ? "Mainnet" : "Testnet"; // Mock opposite

  return (
    <div
      className="network-warning-banner"
      style={{
        position: "fixed",
        top: "80px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "600px",
        width: "90%",
        padding: "16px 20px",
        background: "rgba(255, 69, 58, 0.95)",
        border: "1px solid rgba(255, 69, 58, 0.8)",
        borderRadius: "12px",
        boxShadow: "0 8px 32px rgba(255, 69, 58, 0.3)",
        backdropFilter: "blur(12px)",
        color: "white",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <AlertTriangle size={24} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "4px" }}>
          Wrong Stellar Network
        </div>
        <div style={{ fontSize: "0.9rem", lineHeight: "1.4" }}>
          You are connected to Stellar {currentNetwork}, but this vault requires {expectedNetwork}.
          Please switch networks in your wallet to continue.
        </div>
      </div>
      <button
        onClick={handleDismiss}
        style={{
          background: "none",
          border: "none",
          color: "white",
          cursor: "pointer",
          padding: "4px",
          opacity: 0.8,
          transition: "opacity 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.8")}
        aria-label="Dismiss network warning"
      >
        <X size={20} />
      </button>
    </div>
  );
};

export default NetworkWarningBanner;