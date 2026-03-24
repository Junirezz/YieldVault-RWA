import React from 'react';
import { useVault } from '../context/VaultContext';
import { Activity } from 'lucide-react';

const Analytics: React.FC = () => {
    const { formattedTvl } = useVault();

    return (
        <div className="glass-panel" style={{ padding: '32px' }}>
            <header style={{ textAlign: 'center', marginBottom: '48px' }}>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '16px' }}>
                    <span className="text-gradient">Project Analytics</span>
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
                    Historical performance and pool health metrics.
                </p>
            </header>

            <div className="flex gap-lg" style={{ flexWrap: 'wrap' }}>
                <div className="glass-panel" style={{ flex: '1 1 300px', padding: '24px', background: 'var(--bg-muted)' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                        Total Value Locked
                        <span style={{ color: 'var(--accent-cyan)', fontSize: '0.7rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Activity size={10} className="animate-pulse" />
                            LIVE
                        </span>
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 600 }}>{formattedTvl}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', marginTop: '8px' }}>+12.5% this month</div>
                </div>
                <div className="glass-panel" style={{ flex: '1 1 300px', padding: '24px', background: 'var(--bg-muted)' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Vault Participants</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 600 }}>1,248</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', marginTop: '8px' }}>+82 new users</div>
                </div>
                <div className="glass-panel" style={{ flex: '1 1 300px', padding: '24px', background: 'var(--bg-muted)' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Strategy Stability</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 600 }}>99.9%</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', marginTop: '8px' }}>Tracking Sovereign Bonds</div>
                </div>
            </div>

            <div className="glass-panel" style={{ marginTop: '32px', padding: '48px', textAlign: 'center', background: 'var(--bg-muted)' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Interactive Charts coming soon...</div>
            </div>
        </div>
    );
};

export default Analytics;
