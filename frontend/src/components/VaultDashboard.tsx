import { useState, useEffect } from "react";
import { Activity, ShieldCheck, TrendingUp, Wallet as WalletIcon, Loader2 } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useVault } from "../context/VaultContext";
import ApiStatusBanner from "./ApiStatusBanner";
import VaultPerformanceChart from "./VaultPerformanceChart";
import { useToast } from "../context/ToastContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { useDepositMutation, useWithdrawMutation } from "../hooks/useVaultMutations";
import CopyButton from "./CopyButton";

interface VaultDashboardProps {
  walletAddress: string | null;
  usdcBalance?: number;
}

const VaultDashboard: React.FC<VaultDashboardProps> = ({
  walletAddress,
  usdcBalance = 0,
}) => {
  const { formattedTvl, formattedApy, summary, error, isLoading } = useVault();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  const depositMutation = useDepositMutation();
  const withdrawMutation = useWithdrawMutation();

  useEffect(() => {
    const handleTrigger = () => {
      setActiveTab("deposit");
      setTimeout(() => {
        const input = document.querySelector('.input-field') as HTMLInputElement | null;
        if (input) input.focus();
      }, 0);
    };
    window.addEventListener('TRIGGER_DEPOSIT', handleTrigger);
    return () => window.removeEventListener('TRIGGER_DEPOSIT', handleTrigger);
  }, []);

  const isProcessing = depositMutation.isPending
    ? "deposit"
    : withdrawMutation.isPending
      ? "withdraw"
      : null;

  const availableBalance = walletAddress ? usdcBalance : 0;
  const strategy = summary.strategy;

  const handleTransaction = async (actionType: "deposit" | "withdraw") => {
    const value = Number(amount);

    if (!walletAddress) {
      toast.warning({
        title: "Wallet required",
        description: "Connect your wallet before submitting a transaction.",
      });
      return;
    }

    if (!amount || Number.isNaN(value) || value <= 0) {
      toast.warning({
        title: "Enter a valid amount",
        description: "Choose a valid USDC amount before submitting the transaction.",
      });
      return;
    }

    if (actionType === "withdraw" && value > availableBalance) {
      toast.warning({
        title: "Insufficient balance",
        description: "The withdrawal amount exceeds your available USDC balance.",
      });
      return;
    }
    if (actionType === "deposit" && value > availableBalance) {
      toast.warning({
        title: "Amount exceeds maximum",
        description: "Deposit amount cannot exceed your available USDC balance.",
      });
      return;
    }

    try {
      if (actionType === "deposit") {
        await depositMutation.mutateAsync({ walletAddress, amount: value });
      } else {
        await withdrawMutation.mutateAsync({ walletAddress, amount: value });
      }

      setAmount("");
      toast.success({
        title: actionType === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description: actionType === "deposit" 
          ? `${value.toFixed(2)} USDC has been deposited into the vault.`
          : `${value.toFixed(2)} USDC has been withdrawn from the vault.`,
      });
    } catch (err: any) {
      toast.error({
        title: "Transaction Failed",
        description: err.message || "An error occurred during the transaction.",
      });
    }
  };

  return (
    <div className="vault-dashboard gap-lg">
      <div className="vault-dashboard-stats">
        <div className="glass-panel" style={{ padding: "32px" }}>
          {error && <ApiStatusBanner error={error} />}
          <div className="vault-stats-header flex justify-between items-center" style={{ marginBottom: "24px" }}>
            <div>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "4px" }}>Global RWA Yield Fund</h2>
              <span className="tag" style={{ background: "rgba(255, 255, 255, 0.05)", color: "var(--text-secondary)" }}>
                Tokens: USDC
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Current APY</div>
              <div className="text-gradient" style={{ fontSize: "2rem", fontFamily: "var(--font-display)", fontWeight: 700 }}>
                {formattedApy}
              </div>
            </div>
          </div>

          <div style={{ height: "1px", background: "var(--border-glass)", margin: "24px 0" }} />

          <div className="vault-stats-meta flex gap-xl" style={{ marginBottom: "32px" }}>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                Total Value Locked
                <span className="flex items-center gap-xs" style={{ color: "var(--accent-cyan)", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <Activity size={10} className={isLoading ? "animate-pulse" : undefined} />
                  {isLoading ? "Syncing" : "Live"}
                </span>
              </div>
              <div style={{ fontSize: "1.25rem", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                {formattedTvl}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}>Underlying Asset</div>
              <div className="flex items-center gap-sm">
                <ShieldCheck size={16} color="var(--accent-cyan)" />
                <span style={{ fontSize: "1.1rem", fontWeight: 500 }}>{summary.assetLabel}</span>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "20px", background: "var(--bg-muted)" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <TrendingUp size={18} color="var(--accent-purple)" />
              Strategy Overview
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: "1.6" }}>
              This vault pools USDC and deploys it into verified tokenized sovereign bonds available on the Stellar network.
            </p>
            <div className="flex gap-md" style={{ marginTop: "14px", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px", padding: "10px 12px", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-glass)" }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>Target Allocation</div>
                <div style={{ fontWeight: 600 }}>70% Treasuries</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>30% Cash Reserve</div>
              </div>
              <div style={{ flex: "1 1 150px", padding: "10px 12px", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-glass)" }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>Yield Distribution</div>
                <div style={{ fontWeight: 600 }}>Daily Compounding</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>Reflected in yvUSDC NAV</div>
              </div>
              <div style={{ flex: "1 1 150px", padding: "10px 12px", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-glass)" }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>Risk Controls</div>
                <div style={{ fontWeight: 600 }}>Issuer + Duration Caps</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>Rebalanced every epoch</div>
              </div>
            </div>
            <div style={{ marginTop: "12px", color: "var(--text-secondary)", fontSize: "0.82rem" }}>
              Strategy: <span style={{ color: "var(--text-primary)" }}>{strategy.name}</span> ({strategy.issuer})
            </div>
            <div className="copy-field" style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "0.78rem" }}>
              <span>Strategy ID:</span>
              <span className="copy-field-value copy-field-value-mono">{strategy.id}</span>
              <CopyButton value={strategy.id} label="strategy ID" />
            </div>
          </div>
        </div>
      </div>

      <div className="vault-dashboard-chart">
        <div className="glass-panel vault-chart-panel">
          <VaultPerformanceChart />
        </div>
      </div>

      <div className="vault-dashboard-actions">
        <div className="glass-panel" style={{ padding: "32px", position: "relative", overflow: "hidden" }}>
          {!walletAddress && (
            <div className="wallet-overlay" style={{ position: "absolute", inset: 0, background: "var(--bg-overlay)", backdropFilter: "blur(8px)", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px", textAlign: "center" }}>
              <WalletIcon size={48} color="var(--accent-cyan)" style={{ marginBottom: "16px", opacity: 0.8 }} />
              <h3>Wallet Not Connected</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Please connect your Freighter wallet to interact with the vault.</p>
            </div>
          )}

          <Tabs value={activeTab} defaultValue="deposit" onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList style={{ marginBottom: "24px" }}>
              <TabsTrigger value="deposit">Deposit</TabsTrigger>
              <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            </TabsList>

            {(["deposit", "withdraw"] as const).map((tab) => (
              <TabsContent key={tab} value={tab}>
                <div style={{ marginBottom: "24px" }}>
                  <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                    <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                      {tab === "deposit" ? "Amount to deposit" : "Amount to withdraw"}
                    </div>
                    <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                      Balance: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{availableBalance.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="input-group">
                    <div className="input-wrapper">
                      <span style={{ color: "var(--text-secondary)", paddingRight: "12px", borderRight: "1px solid var(--border-glass)", marginRight: "16px" }}>USDC</span>
                      <input className="input-field" type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isProcessing !== null} />
                      <button className="btn-max" onClick={() => setAmount(availableBalance.toFixed(2))} disabled={!walletAddress || availableBalance <= 0 || isProcessing !== null}>
                        MAX
                      </button>
                    </div>
                  </div>
                </div>

                <button className="btn btn-primary" style={{ width: "100%", padding: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }} onClick={() => handleTransaction(tab)} disabled={isProcessing !== null || !amount || Number(amount) <= 0}>
                  {isProcessing === tab ? (
                    <>
                      <Loader2 size={16} className="spin" style={{ animation: "spin 0.9s linear infinite" }} />
                      Processing Transaction...
                    </>
                  ) : (
                    tab === "deposit" ? "Approve & Deposit" : "Withdraw Funds"
                  )}
                </button>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default VaultDashboard;
