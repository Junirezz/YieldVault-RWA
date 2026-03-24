import React from 'react';

interface PortfolioProps {
  walletAddress: string | null;
}

const Portfolio: React.FC<PortfolioProps> = ({ walletAddress }) => {
  return (
    <div className="glass-panel" style={{ padding: '32px' }}>
      <header style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '16px' }}>
          Your <span className="text-gradient">Portfolio</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
          Overview of your deposited real-world assets.
        </p>
      </header>

      {!walletAddress ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Please connect your wallet to view your portfolio.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-lg">
          <div className="glass-panel" style={{ padding: '24px', background: 'var(--bg-muted)' }}>
            <div className="flex justify-between items-center">
              <div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Total Assets</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 600 }}>$1,250.50</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Unrealized Gain</div>
                <div style={{ fontSize: '1.2rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>+$42.15</div>
              </div>
            </div>
          </div>
          
          <div className="glass-panel" style={{ padding: '24px', background: 'var(--bg-muted)' }}>
            <h3 style={{ marginBottom: '16px' }}>Stellar RWA Yield Fund</h3>
            <div className="flex justify-between items-center">
              <div>
                <span className="tag cyan">USDC</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>1,250.50 yvUSDC</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>APY 8.45%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portfolio;
