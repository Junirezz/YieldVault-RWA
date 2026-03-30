import { NavLink } from 'react-router-dom';
import WalletConnect from './WalletConnect';
import ThemeToggle from './ThemeToggle';
import { Layers } from './icons';
import { useTranslation } from '../i18n';

interface NavbarProps {
    currentPath: '/' | '/analytics' | '/portfolio';
    onNavigate: (path: '/' | '/analytics' | '/portfolio') => void;
    walletAddress: string | null;
    onConnect: (address: string) => void;
    onDisconnect: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  walletAddress,
  onConnect,
  onDisconnect,
}) => {
  const { t } = useTranslation();
  return (
    <nav
      aria-label="Primary"
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

          <div className="flex gap-lg" style={{ marginLeft: "32px" }}>
            <NavLink
              to="/"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: "var(--font-medium)",
                fontSize: "var(--text-base)",
              })}
            >
              {t("nav.vaults")}
            </NavLink>
            <NavLink
              to="/portfolio"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: "var(--font-medium)",
                fontSize: "var(--text-base)",
              })}
            >
              {t("nav.portfolio")}
            </NavLink>
            <NavLink
              to="/analytics"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
                textDecoration: "none",
                fontWeight: "var(--font-medium)",
                fontSize: "var(--text-base)",
              })}
            >
              {t("nav.analytics")}
            </NavLink>
          </div>
        </div>
            </div>
        </nav>
    );
};

export default Navbar;
