import React, { useEffect, useState } from "react";
import { Activity, AlertCircle, ShieldCheck, TrendingUp, Wallet as WalletIcon, Loader2, AlertTriangle, Info } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useVault } from "../context/VaultContext";
import ApiStatusBanner from "./ApiStatusBanner";
import VaultPerformanceChart from "./VaultPerformanceChart";
import { useToast } from "../context/ToastContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { FormField, SubmitButton } from "../forms";
import { useDepositMutation, useWithdrawMutation } from "../hooks/useVaultMutations";
import TransactionStatus, { type ActionStatus } from "./TransactionStatus";
import CopyButton from "./CopyButton";

interface VaultDashboardProps {
  walletAddress: string | null;
  usdcBalance?: number;
}

const VaultCapWarning: React.FC<{ utilization: number; isReached: boolean }> = ({ utilization, isReached }) => {
  const percent = (utilization * 100).toFixed(1);
  
  return (
    <div 
      className="glass-panel" 
      style={{ 
        padding: "16px", 
        marginBottom: "24px", 
        border: `1px solid ${isReached ? 'var(--text-error)' : 'var(--text-warning)'}`,
        background: isReached ? 'rgba(255, 69, 58, 0.1)' : 'rgba(255, 159, 10, 0.1)',
        display: "flex",
        alignItems: "flex-start",
        gap: "12px"
      }}
    >
      <AlertCircle color={isReached ? "var(--text-error)" : "var(--text-warning)"} size={20} />
      <div>
        <div style={{ fontWeight: 600, color: isReached ? 'var(--text-error)' : 'var(--text-warning)', marginBottom: "4px" }}>
          {isReached ? 'Vault Capacity Reached' : 'Vault Near Capacity'}
        </div>
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
          {isReached 
            ? `This vault has reached its maximum deposit cap of ${percent}%. Deposits are temporarily disabled.`
            : `This vault is at ${percent}% capacity. New deposits may be restricted soon.`}
        </div>
      </div>
    </div>
  );
};

const VaultDashboard: React.FC<VaultDashboardProps> = ({
  walletAddress,
  usdcBalance = 0,
}) => {
  const {
    formattedTvl,
    formattedApy,
    summary,
    error,
    isLoading,
    utilization,
    isCapWarning,
    isCapReached,
  } = useVault();
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
  const isBusy = isProcessing !== null;
  const strategy = summary.strategy;
  const enteredAmount = Number(amount);
  const isValidAmount = Number.isFinite(enteredAmount) && enteredAmount > 0;
  const managementFeeBps = 35;
  const estimatedFee = isValidAmount ? (enteredAmount * managementFeeBps) / 10_000 : 0;
  const estimatedNetAmount = isValidAmount ? Math.max(enteredAmount - estimatedFee, 0) : 0;

  const utilization = summary.depositCap ? (summary.tvl / summary.depositCap) * 100 : 0;
  const isCapReached = summary.depositCap ? summary.tvl >= summary.depositCap : false;
  const isCapWarning = summary.depositCap ? utilization >= 90 : false;

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
          {error && (
            <ApiStatusBanner error={{ ...error, userMessage: "Failed to load vault data" }} />
          )}
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
                {(isCapReached || isCapWarning) && tab === "deposit" && (
                   <VaultCapWarning utilization={utilization} isReached={isCapReached} />
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleTransaction(tab);
                  }}
                >
                  <div style={{ marginBottom: "24px" }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                      <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                        {tab === "deposit" ? "Amount to deposit" : "Amount to withdraw"}
                      </div>
                      <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                        Balance:{" "}
                        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                          {walletAddress ? availableBalance.toFixed(2) : "0.00"}
                        </span>
                      </div>
                    </div>

                    <div className="input-group">
                      <div className="input-wrapper">
                        <span style={{ color: "var(--text-secondary)", paddingRight: "12px", borderRight: "1px solid var(--border-glass)", marginRight: "16px" }}>USDC</span>
                        <input className="input-field" type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isProcessing !== null || (tab === "deposit" && isCapReached)} />
                        <button type="button" className="btn-max" onClick={() => setAmount(availableBalance.toFixed(2))} disabled={!walletAddress || availableBalance <= 0 || isProcessing !== null || (tab === "deposit" && isCapReached)}>
                          MAX
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: "14px 16px", background: "rgba(0, 0, 0, 0.15)", marginBottom: "16px" }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: "6px" }}>
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.86rem" }}>Estimated protocol fee</span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                        {isValidAmount ? `${estimatedFee.toFixed(4)} USDC` : "0.0000 USDC"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                        {tab === "deposit" ? "Estimated net deposit" : "Estimated net withdrawal"}
                      </span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                        {isValidAmount ? `${estimatedNetAmount.toFixed(4)} USDC` : "0.0000 USDC"}
                      </span>
                    </div>
                    <div style={{ marginTop: "6px", color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                      Network fee: {summary.networkFeeEstimate}
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }} disabled={isProcessing !== null || !amount || Number(amount) <= 0 || (tab === "deposit" && isCapReached)}>
                    {isProcessing === tab ? (
                      <>
                        <Loader2 size={16} className="spin" style={{ animation: "spin 0.9s linear infinite" }} />
                        Processing Transaction...
                      </>
                    ) : (
                      tab === "deposit" ? (isCapReached ? "Vault is full" : "Approve & Deposit") : "Withdraw Funds"
                    )}
                  </button>
                </form>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default VaultDashboard;
