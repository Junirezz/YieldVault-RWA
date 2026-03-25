import React from 'react';
import VaultDashboard from '../components/VaultDashboard';

interface HomeProps {
  walletAddress: string | null;
  usdcBalance: number;
}

const Home: React.FC<HomeProps> = ({ walletAddress, usdcBalance }) => {
  return (
    <>
      <header style={{ textAlign: "center", marginBottom: "48px" }}>
        <span className="tag cyan" style={{ marginBottom: "16px" }}>
          Stellar RWA Yield
        </span>
        <h1 className="home-hero-title" style={{ marginBottom: "16px" }}>
          Institutional Yields, <br />
          <span className="text-gradient">Decentralized Access.</span>
        </h1>
        <p
          className="home-hero-subtitle"
          style={{
            color: "var(--text-secondary)",
            fontSize: "1.2rem",
            maxWidth: "600px",
            margin: "0 auto",
          }}
        >
          Deposit USDC to earn stable, predictable yield backed by tokenized
          Sovereign Debt and Real-World Assets.
        </p>
      </header>

      <VaultDashboard walletAddress={walletAddress} usdcBalance={usdcBalance} />
    </>
  );
};

export default Home;
