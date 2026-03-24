import React, { useState, useEffect } from 'react';
import { isAllowed, setAllowed, getAddress } from '@stellar/freighter-api';
import { Wallet, LogOut, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { hasCustomRpcConfig, networkConfig } from '../config/network';

interface WalletConnectProps {
    walletAddress: string | null;
    onConnect: (address: string) => void;
    onDisconnect: () => void;
}

const WalletConnect: React.FC<WalletConnectProps> = ({ walletAddress, onConnect, onDisconnect }) => {
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkConnection = async () => {
            try {
                if (await isAllowed()) {
                    const userInfo = await getAddress();
                    if (userInfo.address) {
                        onConnect(userInfo.address);
                    }
                }
            } catch (e) {
                console.error("Error checking Freighter connection:", e);
            }
        };
        checkConnection();
    }, [onConnect]);

    const handleConnect = async () => {
        setIsConnecting(true);
        setError(null);
        try {
            await setAllowed();
            if (await isAllowed()) {
                const userInfo = await getAddress();
                if (userInfo.address) {
                    onConnect(userInfo.address);
                }
            } else {
                setError("Could not retrieve public key.");
            }
        } catch (e: unknown) {
            console.error(e);
            setError("Failed to connect to Freighter. Ensure the extension is installed and unlocked.");
        } finally {
            setIsConnecting(false);
        }
    };

    const formatAddress = (addr: string) => {
        return `${addr.substring(0, 5)}...${addr.substring(addr.length - 4)}`;
    };

    if (walletAddress) {
        return (
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-md"
            >
                <div
                    className="glass-panel"
                    style={{
                        padding: '8px 16px',
                        borderRadius: '99px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        border: '1px solid var(--accent-cyan-dim)',
                        boxShadow: '0 0 10px rgba(0,240,255,0.1)'
                    }}
                >
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-cyan)', boxShadow: '0 0 8px var(--accent-cyan)' }} />
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{formatAddress(walletAddress)}</span>
                </div>
                <div
                    className="glass-panel"
                    style={{
                        padding: '8px 12px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-glass)',
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        maxWidth: '260px'
                    }}
                    title={networkConfig.rpcUrl}
                >
                    RPC: {hasCustomRpcConfig ? 'Custom' : 'Default'}
                </div>
                <button className="btn btn-outline" style={{ padding: '8px', borderRadius: '50%' }} onClick={onDisconnect} aria-label="Disconnect Wallet">
                    <LogOut size={18} />
                </button>
            </motion.div>
        );
    }

    return (
        <div style={{ position: 'relative' }}>
            <button
                className="btn btn-primary animate-glow"
                onClick={handleConnect}
                disabled={isConnecting}
            >
                {isConnecting ? <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Wallet size={18} />}
                {isConnecting ? 'Connecting...' : 'Connect Freighter'}
            </button>
            {error && (
                <div style={{ position: 'absolute', top: '100%', right: '0', marginTop: '8px', background: 'var(--bg-error)', color: 'var(--text-error)', padding: '8px 12px', borderRadius: '8px', fontSize: '0.8rem', whiteSpace: 'nowrap', border: '1px solid var(--border-error)' }}>
                    {error}
                </div>
            )}
            <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
        </div>
    );
};

export default WalletConnect;
