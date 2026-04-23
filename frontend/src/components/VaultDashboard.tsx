import React, { useEffect, useState } from "react";
import { Activity, ShieldCheck, TrendingUp, Wallet as WalletIcon, AlertTriangle, Info } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useVault } from "../context/VaultContext";
import ApiStatusBanner from "./ApiStatusBanner";
import VaultPerformanceChart from "./VaultPerformanceChart";
import { useToast } from "../context/ToastContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { FormField, SubmitButton } from "../forms";
import CopyButton from "./CopyButton";
import { useDepositMutation, useWithdrawMutation } from "../hooks/useVaultMutations";
import TransactionStatus, { type ActionStatus } from "./TransactionStatus";

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
      {isReached ? <AlertTriangle color="var(--text-error)" size={20} /> : <Info color="var(--text-warning)" size={20} />}
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

function buildFakeTxHash(walletAddress: string, action: "deposit" | "withdraw", amount: number): string {
  const seed = `${walletAddress}-${action}-${amount.toFixed(2)}-${Date.now()}`;
  let hash = "";
  for (let i = 0; i < 64; i += 1) {
    const code = seed.charCodeAt(i % seed.length);
    hash += ((code + i * 13) % 16).toString(16);
  }
  return hash;
}

const STATUS_VISIBLE_MS = 12000;

const VaultDashboard: React.FC<VaultDashboardProps> = ({
  walletAddress,
  usdcBalance = 0,
}) => {
  const { formattedTvl, formattedApy, summary, error, isLoading } = useVault();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [actionStatus, setActionStatus] = useState<ActionStatus>({
    state: "idle",
    title: "",
    description: "",
  });

  const depositMutation = useDepositMutation();
  const withdrawMutation = useWithdrawMutation();
  const isBusy = depositMutation.isPending || withdrawMutation.isPending;

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

  useEffect(() => {
    if (actionStatus.state === "idle") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setActionStatus({ state: "idle", title: "", description: "" });
    }, STATUS_VISIBLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [actionStatus]);

  const handleTransaction = async (actionType: "deposit" | "withdraw") => {
    const value = Number(amount);
    if (!walletAddress) {
      toast.warning({
        title: "Wallet required",
        description: "Connect your wallet before submitting an action.",
        description: "Connect your wallet before submitting a transaction.",
      });
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.warning({
        title: "Invalid amount",
        description: "Enter a valid USDC amount greater than zero.",
        title: "Enter a valid amount",
        description: "Choose a valid USDC amount before submitting the transaction.",
      });
      return;
    }
    if (actionType === "withdraw" && value > availableBalance) {
      toast.warning({
        title: "Insufficient balance",
        description: "Reduce the withdrawal amount or add more USDC.",
        description: "The withdrawal amount exceeds your available USDC balance.",
      });
      return;
    }

    const txHash = buildFakeTxHash(walletAddress, actionType, value);
    setActionStatus({
      state: "pending",
      title: `${actionType === "deposit" ? "Deposit" : "Withdrawal"} pending`,
      description:
        "Transaction submitted. Waiting for network confirmation before finalizing balances.",
      txHash,
      actionLabel: actionType,
    });

    try {
      if (actionType === "deposit") {
        await depositMutation.mutateAsync({ walletAddress, amount: value });
      } else {
        await withdrawMutation.mutateAsync({ walletAddress, amount: value });
      }

      setAmount("");
      setActionStatus({
        state: "success",
        title: `${actionType === "deposit" ? "Deposit" : "Withdrawal"} confirmed`,
        description: `${value.toFixed(2)} USDC confirmed on network. Your portfolio view is being refreshed.`,
        txHash,
        actionLabel: actionType,
      });
      toast.success({
        title: "Transaction confirmed",
        description: "Balances and activity have been updated from latest data.",
      });
    } catch (unknownError) {
      const errorMessage =
        unknownError instanceof Error
          ? unknownError.message
          : "Unknown error occurred while broadcasting transaction.";
      setActionStatus({
        state: "failure",
        title: `${actionType === "deposit" ? "Deposit" : "Withdrawal"} failed`,
        description: `${errorMessage} Please review wallet approvals, network connectivity, and retry.`,
        txHash,
        actionLabel: actionType,
        title: actionType === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description: actionType === "deposit" 
          ? `${value.toFixed(2)} USDC has been deposited into the vault.`
          : `${value.toFixed(2)} USDC has been withdrawn from the vault.`,
      });
      toast.error({
        title: "Transaction failed",
        description: errorMessage,
        title: "Transaction Failed",
        description: err.message || "An error occurred during the transaction.",
      });
    }
  };

  const strategy = summary.strategy;

  return (
    <div className="vault-dashboard gap-lg">
      <div className="vault-dashboard-stats">
        <div className="glass-panel" style={{ padding: "32px" }}>
          {error ? <ApiStatusBanner error={error} /> : null}

          {error && <ApiStatusBanner error={error} />}
          <div className="vault-stats-header flex justify-between items-center" style={{ marginBottom: "24px" }}>
            <div>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "4px" }}>Global RWA Yield Fund</h2>
              <span className="tag" style={{ background: "rgba(255, 255, 255, 0.05)", color: "var(--text-secondary)" }}>
                Tokens: USDC
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Current APY
              </div>
              <div
                className="text-gradient"
                style={{
                  fontSize: "2rem",
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                }}
              >
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
                <span
                  className="flex items-center gap-xs"
                  style={{
                    color: "var(--accent-cyan)",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
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
            <div className="copy-field" style={{ marginTop: "12px", color: "var(--text-secondary)", fontSize: "0.82rem" }}>
              <span>Strategy ID:</span>
              <span className="copy-field-value copy-field-value-mono">{strategy.id}</span>
              <CopyButton value={strategy.id} label="strategy ID" successDescription="The strategy ID has been copied to your clipboard." />
            </div>
            <div style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "0.78rem" }}>
              RPC: {hasCustomRpcConfig ? "Custom" : "Default"} - {networkConfig.rpcUrl}
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
          {!walletAddress ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "var(--bg-overlay)",
                backdropFilter: "blur(8px)",
                zIndex: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px",
                textAlign: "center",
              }}
            >
              <WalletIcon size={48} color="var(--accent-cyan)" style={{ marginBottom: "16px", opacity: 0.8 }} />
              <h3 style={{ marginBottom: "8px" }}>Wallet Not Connected</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "24px" }}>
                Please connect your Freighter wallet to deposit USDC and earn RWA yields.
              </p>
            </div>
          ) : null}
          {!walletAddress && (
            <div className="wallet-overlay" style={{ position: "absolute", inset: 0, background: "var(--bg-overlay)", backdropFilter: "blur(8px)", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px", textAlign: "center" }}>
              <WalletIcon size={48} color="var(--accent-cyan)" style={{ marginBottom: "16px", opacity: 0.8 }} />
              <h3>Wallet Not Connected</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Please connect your wallet to interact with the vault.</p>
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

                    <FormField
                      label={tab === "deposit" ? "Deposit amount" : "Withdrawal amount"}
                      name={`${tab}-amount`}
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      disabled={isBusy || (tab === "deposit" && isCapReached)}
                    />

                    <div className="flex justify-between items-center" style={{ margin: "16px 0 24px" }}>
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Asset: USDC</span>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => setAmount(availableBalance.toFixed(2))}
                        disabled={!walletAddress || availableBalance <= 0 || isBusy || (tab === "deposit" && isCapReached)}
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  <SubmitButton
                    loading={isBusy && activeTab === tab}
                    disabled={!walletAddress || isBusy || !amount || Number(amount) <= 0 || (tab === "deposit" && isCapReached)}
                    label={tab === "deposit" ? (isCapReached ? "Vault is full" : "Approve & Deposit") : "Withdraw Funds"}
                    loadingLabel="Waiting for confirmation..."
                  />
                </form>
              </TabsContent>
            ))}
          </Tabs>

          <TransactionStatus status={actionStatus} />
        </div>
      </div>
    </div>
  );
};

export default VaultDashboard;
