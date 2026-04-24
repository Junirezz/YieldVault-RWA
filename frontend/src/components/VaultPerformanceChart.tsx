import React from "react";
import { TrendingUp } from "./icons";
import { useVaultHistory } from "../hooks/useVaultData";

const VaultPerformanceChart: React.FC = () => {
  const { data: _history = [] } = useVaultHistory();

  return (
    <div style={{ width: "100%" }}>
      <h3
        style={{
          fontSize: "1.1rem",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <TrendingUp size={18} color="var(--accent-cyan)" />
        Historical performance
      </h3>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: "0.82rem",
          marginBottom: "16px",
        }}
      >
        yvUSDC share price index (100 = baseline)
      </p>
      <div className="vault-chart-canvas" style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: '8px',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <p>Chart temporarily disabled</p>
          <p style={{ fontSize: '0.75rem' }}>Diagnosing Recharts 504 error...</p>
        </div>
      </div>
    </div>
  );
};

export default VaultPerformanceChart;
