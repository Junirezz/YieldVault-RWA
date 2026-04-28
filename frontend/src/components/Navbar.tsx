import { useEffect, useRef, useState, type FC } from "react";
import { NavLink } from "react-router-dom";
import { X, Menu } from "lucide-react";
import WalletConnect from "./WalletConnect";
import type { DisconnectReason } from "./WalletConnect";
import ThemeToggle from "./ThemeToggle";
import TvlTicker from "./TvlTicker";
import { Layers } from "./icons";
import { useTranslation } from "../i18n";
import { networkConfig } from "../config/network";

interface NavbarProps {
  currentPath?: "/" | "/analytics" | "/portfolio";
  onNavigate?: (path: "/" | "/analytics" | "/portfolio") => void;
  walletAddress: string | null;
  usdcBalance?: number;
  onConnect: (address: string) => void;
  onDisconnect: (reason?: DisconnectReason) => void;
}

const Navbar: FC<NavbarProps> = ({
  walletAddress,
  usdcBalance = 0,
  onConnect,
  onDisconnect,
}) => {
  const { t } = useTranslation();
  const [networkLabel, setNetworkLabel] = useState(
    networkConfig.isTestnet ? "Testnet" : "Mainnet",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Resolve network label
  useEffect(() => {
    let active = true;

    const resolveNetworkLabel = async () => {
      if (!walletAddress) return;
      try {
        const freighterApi = await import("@stellar/freighter-api");
        if (typeof freighterApi.getNetworkDetails !== "function") return;

        const details = await freighterApi.getNetworkDetails();
        if (!active || !details) return;

        const isMainnet = details.networkPassphrase
          ?.toLowerCase()
          .includes("public");

        setNetworkLabel(isMainnet ? "Mainnet" : "Testnet");
      } catch {
        // fallback stays
      }
    };

    void resolveNetworkLabel();

    const interval = window.setInterval(() => {
      void resolveNetworkLabel();
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [walletAddress]);

  return (
    <nav
      aria-label="Primary"
      ref={menuRef}
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
        {/* LEFT */}
        <div className="flex items-center gap-xl">
          <NavLink
            to="/"
            className="flex items-center gap-sm"
            style={{ textDecoration: "none" }}
            onClick={() => setIsMobileMenuOpen(false)}
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
                fontWeight: "var(--font-bold)",
                fontSize: "var(--text-xl)",
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
                marginLeft: "8px",
              }}
            >
              {t("nav.brand.primary")}{" "}
              <span style={{ color: "var(--accent-cyan)" }}>
                {t("nav.brand.accent")}
              </span>
            </span>
          </NavLink>

          {/* Desktop links */}
          <div className="flex gap-lg nav-desktop-links" style={{ marginLeft: "32px" }}>
            <NavLink to="/" className="nav-link">
              {t("nav.vaults")}
            </NavLink>
            <NavLink to="/portfolio" className="nav-link">
              {t("nav.portfolio")}
            </NavLink>
            <NavLink to="/analytics" className="nav-link">
              {t("nav.analytics")}
            </NavLink>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex items-center gap-md">
          <TvlTicker />

          <div className="flex items-center gap-sm nav-desktop-links">
            {walletAddress && (
              <span
                aria-label="Network badge"
                title={`Connected network: ${networkLabel}`}
                style={{
                  padding: "6px 10px",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontWeight: "var(--font-semibold)",
                  textTransform: "uppercase",
                  border:
                    networkLabel === "Mainnet"
                      ? "1px solid rgba(34, 197, 94, 0.45)"
                      : "1px solid rgba(56, 189, 248, 0.45)",
                  color:
                    networkLabel === "Mainnet"
                      ? "rgb(34, 197, 94)"
                      : "var(--accent-cyan)",
                  background:
                    networkLabel === "Mainnet"
                      ? "rgba(34, 197, 94, 0.08)"
                      : "rgba(0, 240, 255, 0.08)",
                }}
              >
                {networkLabel}
              </span>
            )}
            <ThemeToggle />
          </div>

          <WalletConnect
            walletAddress={walletAddress}
            usdcBalance={usdcBalance}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />

          {/* Mobile toggle */}
          <button
            className="nav-mobile-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-slide-menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="nav-mobile-menu is-open">
          <NavLink to="/" onClick={() => setIsMobileMenuOpen(false)}>
            {t("nav.vaults")}
          </NavLink>
          <NavLink to="/portfolio" onClick={() => setIsMobileMenuOpen(false)}>
            {t("nav.portfolio")}
          </NavLink>
          <NavLink to="/analytics" onClick={() => setIsMobileMenuOpen(false)}>
            {t("nav.analytics")}
          </NavLink>

          <div className="flex items-center justify-between" style={{ marginTop: "24px" }}>
            <ThemeToggle />
            {walletAddress && <span>{networkLabel}</span>}
          </div>
        </div>
      )}

      {/* Dropdown fallback menu */}
      {menuOpen && (
        <div className="nav-mobile-menu" role="menu">
          <NavLink to="/" role="menuitem" onClick={() => setMenuOpen(false)}>
            {t("nav.vaults")}
          </NavLink>
          <NavLink to="/portfolio" role="menuitem" onClick={() => setMenuOpen(false)}>
            {t("nav.portfolio")}
          </NavLink>
          <NavLink to="/analytics" role="menuitem" onClick={() => setMenuOpen(false)}>
            {t("nav.analytics")}
          </NavLink>
        </div>
      )}
    </nav>
  );
};

export default Navbar;