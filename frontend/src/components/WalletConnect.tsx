import React, { useState, useEffect } from "react";
import { setAllowed } from "@stellar/freighter-api";
import { Loader2, LogOut, Wallet } from './icons';
import { hasCustomRpcConfig, networkConfig } from '../config/network';
import { useToast } from '../context/ToastContext';
import { useTranslation } from '../i18n';
import CopyButton from './CopyButton';
import { discoverConnectedAddress } from "../lib/stellarAccount";

interface WalletConnectProps {
    walletAddress: string | null;
    onConnect: (address: string) => void;
    onDisconnect: () => void;
}

const WalletConnect: React.FC<WalletConnectProps> = ({ walletAddress, onConnect, onDisconnect }) => {
    const [isConnecting, setIsConnecting] = useState(false);
    const toast = useToast();
    const { t } = useTranslation();

    useEffect(() => {
        let mounted = true;

        const syncConnection = async () => {
            const discoveredAddress = await discoverConnectedAddress();
            if (!mounted) return;

            if (discoveredAddress) {
                onConnect(discoveredAddress);
                return;
            }

            if (walletAddress) {
                onDisconnect();
                toast.info({
                    title: "Wallet disconnected",
                    description: "Freighter is no longer connected to this session.",
                });
            }
        };

        syncConnection();
        const interval = window.setInterval(syncConnection, 10000);

        return () => {
            mounted = false;
            window.clearInterval(interval);
        };
    }, [onConnect, onDisconnect, toast, walletAddress]);

    const handleConnect = async () => {
        setIsConnecting(true);
        try {
            await setAllowed();
            const allowed = await isAllowed();
            if (allowed.isAllowed) {
                const userInfo = await getAddress();
                if (userInfo.address) {
                    onConnect(userInfo.address);
                    toast.success({
                        title: t('toast.walletConnected.title'),
                        description: t('toast.walletConnected.description'),
                    });
                }
            const discoveredAddress = await discoverConnectedAddress();
            if (discoveredAddress) {
                onConnect(discoveredAddress);
                toast.success({
                    title: "Wallet connected",
                    description: "Freighter is now connected to your YieldVault session.",
                });
            } else {
                toast.warning({
                    title: t('toast.walletPermissionRequired.title'),
                    description: t('toast.walletPermissionRequired.description'),
                });
            }
        } catch (e: unknown) {
            console.error(e);
            toast.error({
                title: t('toast.walletConnectionFailed.title'),
                description: t('toast.walletConnectionFailed.description'),
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const formatAddress = (addr: string) => {
        return `${addr.substring(0, 5)}...${addr.substring(addr.length - 4)}`;
    };

    if (walletAddress) {
        return (
            <div className="wallet-status flex items-center gap-md">
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
                    <div className="copy-field">
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }} title={walletAddress}>
                            {formatAddress(walletAddress)}
                        </span>
                        <CopyButton
                            value={walletAddress}
                            label="wallet address"
                            successDescription="The full wallet address has been copied to your clipboard."
                        />
                    </div>
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
                    {t('wallet.rpcPrefix')} {hasCustomRpcConfig ? t('wallet.rpcCustom') : t('wallet.rpcDefault')}
                </div>
                <button
                    className="btn btn-outline"
                    style={{ padding: '8px', borderRadius: '50%' }}
                    onClick={() => {
                        onDisconnect();
                        toast.info({
                            title: t('toast.walletDisconnected.title'),
                            description: t('toast.walletDisconnected.description'),
                        });
                    }}
                    aria-label={t('wallet.disconnectAria')}
                >
                    <LogOut size={18} />
                </button>
            </div>
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
                {isConnecting ? t('wallet.connecting') : t('wallet.connectFreighter')}
            </button>
            <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
        </div>
    );
};

export default WalletConnect;
