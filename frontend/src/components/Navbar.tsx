import React from "react";
import { NavLink } from "react-router-dom";
import WalletConnect from "./WalletConnect";
import ThemeToggle from "./ThemeToggle";
import { Layers } from "./icons";

interface NavbarProps {
  walletAddress: string | null;
  onConnect: (address: string) => void;
  onDisconnect: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  walletAddress,
  onConnect,
  onDisconnect,
}) => {
  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: "var(--bg-surface)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border-glass)",
        padding: "16px 0",
      }}
    >
      <div className="container flex justify-between items-center">
        <div className="flex items-center gap-xl">
          <NavLink
            to="/"
            className="flex items-center gap-sm"
            style={{ textDecoration: "none" }}
          >
            <div
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))",
                padding: "8px",
                borderRadius: "12px",
                boxShadow: "0 0 15px rgba(0, 240, 255, 0.2)",
              }}
            >
              <Layers size={24} color="#000" />
            </div>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.25rem",
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
                marginLeft: "8px",
              }}
            >
              YieldVault{" "}
              <span style={{ color: "var(--accent-cyan)" }}>RWA</span>
            </span>
          </NavLink>

          <div className="flex gap-lg" style={{ marginLeft: "32px" }}>
            <NavLink
              to="/"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.95rem",
              })}
            >
              Vaults
            </NavLink>
            <NavLink
              to="/portfolio"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.95rem",
              })}
            >
              Portfolio
            </NavLink>
            <NavLink
              to="/analytics"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.95rem",
              })}
            >
              Analytics
            </NavLink>
            <NavLink
              to="/transactions"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.95rem",
              })}
            >
              Transactions
            </NavLink>
            <NavLink
              to="/settings"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.95rem",
              })}
            >
              Settings
            </NavLink>
          </div>
        </div>

        <div className="flex items-center gap-md">
          <NavLink
            to="/settings"
            aria-label="Settings"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              border: '1px solid var(--border-glass)',
              background: isActive ? 'rgba(0,240,255,0.08)' : 'var(--bg-surface)',
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              boxShadow: 'var(--shadow-glass)',
              transition: 'all 0.2s ease',
              textDecoration: 'none',
            })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2" />
            </svg>
          </NavLink>
          <ThemeToggle />
          <WalletConnect
            walletAddress={walletAddress}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
