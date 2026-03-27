import React from 'react';
import WalletConnect from './WalletConnect';
import ThemeToggle from './ThemeToggle';
import { Layers } from './icons';

interface NavbarProps {
    currentPath: '/' | '/analytics' | '/portfolio';
    onNavigate: (path: '/' | '/analytics' | '/portfolio') => void;
    walletAddress: string | null;
    onConnect: (address: string) => void;
    onDisconnect: () => void;
}

const navLinkStyle = (isActive: boolean): React.CSSProperties => ({
    color: isActive ? '#fff' : 'var(--text-secondary)',
    fontWeight: isActive ? 600 : 500,
    padding: '8px 12px',
    borderRadius: '9999px',
    background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    border: isActive ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid transparent',
    transition: 'all 0.2s ease'
});

const Navbar: React.FC<NavbarProps> = ({ currentPath, onNavigate, walletAddress, onConnect, onDisconnect }) => {
    return (
        <nav style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            background: 'var(--bg-surface)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--border-glass)',
            padding: '16px 0'
        }}>
            <div className="container flex justify-between items-center">
                <div className="flex items-center gap-sm">
                    <div style={{
                        background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
                        padding: '8px',
                        borderRadius: '12px',
                        boxShadow: '0 0 15px rgba(0, 240, 255, 0.2)'
                    }}>
                        <Layers size={24} color="#000" />
                    </div>
                    <span style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        fontSize: '1.25rem',
                        letterSpacing: '-0.02em',
                        background: 'linear-gradient(90deg, #fff, #94a3b8)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        marginLeft: '8px'
                    }}>
                        YieldVault <span style={{ color: 'var(--accent-cyan)' }}>RWA</span>
                    </span>
                </div>

                <div className="flex items-center gap-sm" style={{ marginLeft: 'auto', marginRight: '24px' }}>
                    <a
                        href="/"
                        style={navLinkStyle(currentPath === '/')}
                        onClick={(event) => {
                            event.preventDefault();
                            onNavigate('/');
                        }}
                    >
                        Vaults
                    </a>
                    <a
                        href="/analytics"
                        style={navLinkStyle(currentPath === '/analytics')}
                        onClick={(event) => {
                            event.preventDefault();
                            onNavigate('/analytics');
                        }}
                    >
                        Analytics
                    </a>
                    <a
                        href="/portfolio"
                        style={navLinkStyle(currentPath === '/portfolio')}
                        onClick={(event) => {
                            event.preventDefault();
                            onNavigate('/portfolio');
                        }}
                    >
                        Portfolio
                    </a>
                </div>

                <div className="flex items-center gap-md">
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
