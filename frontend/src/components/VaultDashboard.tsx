import { useState } from 'react';
import { TrendingUp, ShieldCheck, Wallet as WalletIcon, Activity } from 'lucide-react';
import { benjiStrategy } from '../lib/strategy';
import { hasCustomRpcConfig, networkConfig } from '../config/network';
import { useVault } from '../context/VaultContext';

interface VaultDashboardProps {
    walletAddress: string | null;
}

const VaultDashboard: React.FC<VaultDashboardProps> = ({ walletAddress }) => {
    const { formattedTvl, formattedApy } = useVault();
    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
    const [amount, setAmount] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [fakeBalance, setFakeBalance] = useState(1250.50);

    const yieldRate = formattedApy;
    const tvl = formattedTvl;

    const handleTransaction = () => {
        if (!walletAddress || !amount || isNaN(Number(amount))) return;
        setIsProcessing(true);

        // Simulate transaction delay
        setTimeout(() => {
            const value = Number(amount);
            if (activeTab === 'deposit') setFakeBalance(prev => prev + value);
            if (activeTab === 'withdraw') setFakeBalance(prev => Math.max(0, prev - value));
            setAmount('');
            setIsProcessing(false);
        }, 2000);
    };

    return (
        <div className="flex gap-lg" style={{ flexWrap: 'wrap' }}>
            {/* Left Column - Vault Stats */}
            <div style={{ flex: '1 1 500px' }} className="flex flex-col gap-lg">

                <div className="glass-panel" style={{ padding: '32px' }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: '24px' }}>
                        <div>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '4px' }}>Global RWA Yield Fund</h2>
                            <span className="tag" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)' }}>
                                Tokens: USDC
                            </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Current APY</div>
                            <div className="text-gradient" style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                                {yieldRate}
                            </div>
                        </div>
                    </div>

                    <div style={{ height: '1px', background: 'var(--border-glass)', margin: '24px 0' }} />

                    <div className="flex gap-xl" style={{ marginBottom: '32px' }}>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                Total Value Locked
                                <span className="flex items-center gap-xs" style={{ color: 'var(--accent-cyan)', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    <Activity size={10} className="animate-pulse" />
                                    Live
                                </span>
                            </div>
                            <div style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{tvl}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '4px' }}>Underlying Asset</div>
                            <div className="flex items-center gap-sm">
                                <ShieldCheck size={16} color="var(--accent-cyan)" />
                                <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>Sovereign Debt</span>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '20px', background: 'var(--bg-muted)' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TrendingUp size={18} color="var(--accent-purple)" />
                            Strategy Overview
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            This vault pools USDC and deploys it into verified tokenized sovereign bonds available on the Stellar network.
                            Yields are algorithmically harvested and auto-compounded daily into the vault token price.
                        </p>
                        <div style={{ marginTop: '12px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            Strategy: <span style={{ color: 'var(--text-primary)' }}>{benjiStrategy.name}</span> ({benjiStrategy.issuer})
                        </div>
                        <div style={{ marginTop: '8px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                            RPC: {hasCustomRpcConfig ? 'Custom' : 'Default'} - {networkConfig.rpcUrl}
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Column - User Interaction */}
            <div style={{ flex: '1 1 400px' }}>
                <div className="glass-panel" style={{ padding: '32px', position: 'relative', overflow: 'hidden' }}>

                    {/* Decorative Glow */}
                    <div style={{
                        position: 'absolute',
                        top: '-50px',
                        right: '-50px',
                        width: '150px',
                        height: '150px',
                        background: 'var(--accent-purple)',
                        filter: 'blur(80px)',
                        opacity: 0.2,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />

                    {/* Connect Overlay */}
                    {!walletAddress && (
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'var(--bg-overlay)',
                            backdropFilter: 'blur(8px)',
                            zIndex: 10,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '32px',
                            textAlign: 'center'
                        }}>
                            <WalletIcon size={48} color="var(--accent-cyan)" style={{ marginBottom: '16px', opacity: 0.8 }} />
                            <h3 style={{ marginBottom: '8px' }}>Wallet Not Connected</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
                                Please connect your Freighter wallet to deposit USDC and earn RWA yields.
                            </p>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', background: 'var(--bg-muted)', padding: '6px', borderRadius: '12px' }}>
                        <button
                            onClick={() => setActiveTab('deposit')}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                background: activeTab === 'deposit' ? 'var(--border-glass)' : 'transparent',
                                color: activeTab === 'deposit' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: activeTab === 'deposit' ? 600 : 500,
                                transition: 'all 0.2s',
                                border: activeTab === 'deposit' ? '1px solid var(--border-glass)' : '1px solid transparent'
                            }}
                        >
                            Deposit
                        </button>
                        <button
                            onClick={() => setActiveTab('withdraw')}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                background: activeTab === 'withdraw' ? 'var(--border-glass)' : 'transparent',
                                color: activeTab === 'withdraw' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: activeTab === 'withdraw' ? 600 : 500,
                                transition: 'all 0.2s',
                                border: activeTab === 'withdraw' ? '1px solid var(--border-glass)' : '1px solid transparent'
                            }}
                        >
                            Withdraw
                        </button>
                    </div>

                    <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {activeTab === 'deposit' ? 'Amount to deposit' : 'Amount to withdraw'}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            Balance: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{walletAddress ? fakeBalance.toFixed(2) : '0.00'}</span>
                        </div>
                    </div>

                    <div className="input-group" style={{ marginBottom: '24px' }}>
                        <div className="input-wrapper">
                            <span style={{ color: 'var(--text-secondary)', paddingRight: '12px', borderRight: '1px solid var(--border-glass)', marginRight: '16px' }}>USDC</span>
                            <input
                                className="input-field"
                                type="number"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                            />
                            <button
                                style={{
                                    color: 'var(--accent-cyan)',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    background: 'var(--accent-cyan-dim)',
                                    padding: '4px 10px',
                                    borderRadius: '6px'
                                }}
                                onClick={() => setAmount(fakeBalance.toString())}
                            >
                                MAX
                            </button>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '16px', background: 'var(--bg-muted)', marginBottom: '24px' }}>
                        <div className="flex justify-between items-center" style={{ marginBottom: '8px' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Exchange Rate</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>1 yvUSDC = 1.084 USDC</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Network Fee</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>~0.00001 XLM</span>
                        </div>
                        <div className="flex justify-between items-center" style={{ marginTop: '8px' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>BENJI Strategy</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                {benjiStrategy.status === 'active' ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    </div>

                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '16px', fontSize: '1.1rem' }}
                        onClick={handleTransaction}
                        disabled={isProcessing || !amount || Number(amount) <= 0}
                    >
                        {isProcessing ? 'Processing Transaction...' : (activeTab === 'deposit' ? 'Approve & Deposit' : 'Withdraw Funds')}
                    </button>

                </div>
            </div>
        </div>
    );
};

export default VaultDashboard;
