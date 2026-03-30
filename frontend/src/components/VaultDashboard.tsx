import { useState } from "react";
import { useEffect, useState } from "react";
import {
  Activity,
  ShieldCheck,
  TrendingUp,
  Wallet as WalletIcon,
} from "./icons";
import { useState, useEffect, useRef } from "react";
import { Activity, ShieldCheck, TrendingUp, Wallet as WalletIcon } from "./icons";
import { hasCustomRpcConfig, networkConfig } from "../config/network";
import { useVault } from "../context/VaultContext";
import ApiStatusBanner from "./ApiStatusBanner";
import VaultPerformanceChart from "./VaultPerformanceChart";
import { useToast } from "../context/ToastContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";
import { FormField, SubmitButton } from "../forms";
import CopyButton from "./CopyButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import {
  useDepositMutation,
  useWithdrawMutation,
} from "../hooks/useVaultMutations";

interface VaultDashboardProps {
  walletAddress: string | null;
  usdcBalance?: number;
}

const VaultDashboard: React.FC<VaultDashboardProps> = ({ walletAddress, usdcBalance = 0 }) => {
  const { formattedTvl, formattedApy, summary, error, isLoading } = useVault();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState<"deposit" | "withdraw" | null>(
    null,
  );
  const [fakeBalance, setFakeBalance] = useState(usdcBalance);

  useEffect(() => {
    setFakeBalance(usdcBalance);
  }, [usdcBalance]);

  const strategy = summary.strategy;

  const runTransaction = async (actionType: "deposit" | "withdraw") => {
    const parsedAmount = Number(amount);
    if (!walletAddress) {
      toast.warning({
        title: "Wallet required",
        description: "Connect your wallet before submitting a transaction.",
      });
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.warning({
        title: "Invalid amount",
        description: "Enter an amount greater than 0.",
      });
      return;
    }

    setIsProcessing(actionType);

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        if (actionType === "deposit") {
          setFakeBalance((prev) => prev + parsedAmount);
        } else {
          setFakeBalance((prev) => Math.max(0, prev - parsedAmount));
        }
        setAmount("");
        setIsProcessing(null);
        toast.success({
          title: actionType === "deposit" ? "Deposit queued" : "Withdrawal queued",
          description:
            actionType === "deposit"
              ? `${parsedAmount.toFixed(2)} USDC has been added to pending activity.`
              : `${parsedAmount.toFixed(2)} USDC has been queued for withdrawal.`,
        });
        resolve();
      }, 2000);
    });
  };

  const isBusy = isProcessing !== null;
  const balanceLabel = fakeBalance.toFixed(2);
  const isAmountValid = Number(amount) > 0;

  return (
    <div className="vault-dashboard gap-lg">
            {/* Stats — grid area: stats */}
      <div className="vault-dashboard-stats">
        <div className="glass-panel" style={{ padding: "32px" }}>
          {error && <ApiStatusBanner error={error} />}


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
        description:
          "Choose a valid USDC amount before submitting the transaction.",
      });
        toast.warning({
          title: "Enter a valid amount",
          description: "Choose a valid USDC amount before submitting the transaction.",
        });
      return;
    }

    if (actionType === "withdraw" && value > availableBalance) {
      toast.warning({
        title: "Insufficient balance",
        description:
          "The withdrawal amount exceeds your available USDC balance.",
      });
        toast.warning({
          title: "Insufficient balance",
          description: "The withdrawal amount exceeds your available USDC balance.",
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
        title:
          actionType === "deposit"
            ? "Deposit Successful"
            : "Withdrawal Successful",
        description:
          actionType === "deposit"
            ? `${value.toFixed(2)} USDC has been deposited into the vault.`
            : `${value.toFixed(2)} USDC has been withdrawn from the vault.`,
      });
    } catch (err: any) {
      toast.error({
        title: "Transaction Failed",
        description:
          err.message ||
          "An error occurred during the transaction. Your balance has been restored.",
      });
    }
      setIsProcessing(null);
        toast.success({
          title: actionType === "deposit" ? "Deposit queued" : "Withdrawal queued",
          description:
            actionType === "deposit"
              ? `${value.toFixed(2)} USDC has been added to your pending vault activity.`
              : `${value.toFixed(2)} USDC has been added to your pending withdrawal activity.`,
        });
    }, 2000);
  };

  return (
    <div className="vault-dashboard gap-lg">
      <div className="vault-dashboard-stats">
          <div
            className="vault-stats-header flex justify-between items-center"
            style={{ marginBottom: "24px" }}
          >
            <div>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "4px" }}>
                Global RWA Yield Fund
              </h2>
              <span
                className="tag"
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "var(--text-secondary)",
                }}
              >
                Tokens: USDC
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}
              >
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
                {formattedApy}
              </div>
            </div>
          </div>

          <div
            style={{
              height: "1px",
              background: "var(--border-glass)",
              margin: "24px 0",
            }}
          />

          <div className="vault-stats-meta flex gap-xl" style={{ marginBottom: "32px" }}>
            <div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                Total Value Locked
                <span
                  className="flex items-center"
                  style={{
                    color: "var(--accent-cyan)",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  <Activity size={10} className={isLoading ? "animate-pulse" : undefined} />
                  {isLoading ? "Syncing" : "Live"}
                </span>
              </div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                }}
              >
                {formattedTvl}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}>
                Underlying Asset
              </div>
              <div className="flex items-center gap-sm">
                <ShieldCheck size={16} color="var(--accent-cyan)" />
                <span style={{ fontSize: "1.1rem", fontWeight: 500 }}>
                  {summary.assetLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "20px", background: "var(--bg-muted)" }}>
            <h3
              style={{
                fontSize: "1.1rem",
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <TrendingUp size={18} color="var(--accent-purple)" />
              Strategy Overview
            </h3>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
                lineHeight: "1.6",
              }}
            >
              This vault pools USDC and deploys it into verified tokenized sovereign
              bonds available on the Stellar network. Yields are algorithmically
              harvested and auto-compounded daily into the vault token price.
            </p>
            <div style={{ marginTop: "12px", color: "var(--text-secondary)", fontSize: "0.82rem" }}>
              Strategy: <span style={{ color: "var(--text-primary)" }}>{strategy.name}</span>{" "}
              ({strategy.issuer})
            </div>
            <div style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "0.78rem" }}>
              RPC: {hasCustomRpcConfig ? "Custom" : "Default"} - {networkConfig.rpcUrl}
            </div>
          </div>
        </div>
      </div>

            {/* Chart — grid area: chart */}
      <div className="vault-dashboard-chart">
        <div className="glass-panel vault-chart-panel">
          <VaultPerformanceChart />
        </div>
      </div>

            {/* Deposit / withdraw — grid area: actions */}
      <div className="vault-dashboard-actions">
        <div
          className="glass-panel"
          style={{ padding: "32px", position: "relative", overflow: "hidden" }}
        >
          <div
            style={{
              position: "absolute",
              top: "-50px",
              right: "-50px",
              width: "150px",
              height: "150px",
              background: "var(--accent-purple)",
              filter: "blur(80px)",
              opacity: 0.2,
              borderRadius: "50%",
              pointerEvents: "none",
            }}
          />

          {!walletAddress && (
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
              aria-live="polite"
            >
              <WalletIcon
                size={48}
                color="var(--accent-cyan)"
                style={{ marginBottom: "16px", opacity: 0.8 }}
              />
              <h3 style={{ marginBottom: "8px" }}>Wallet Not Connected</h3>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.9rem",
                  marginBottom: "24px",
                }}
              >
                Please connect your Freighter wallet to deposit USDC and earn RWA
                yields.
              </p>
            </div>
          )}

          <Tabs
            defaultValue="deposit"
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value as "deposit" | "withdraw");
              setAmount("");
            }}
          >
            <TabsList style={{ marginBottom: "24px" }}>
              <TabsTrigger value="deposit">Deposit</TabsTrigger>
              <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            </TabsList>

            <TabsContent value="deposit">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void runTransaction("deposit");
                }}
              >
                <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                    Deposit amount
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    Balance:{" "}
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                      {walletAddress ? balanceLabel : "0.00"}
                    </span>
                  </div>
                </div>

                <FormField
                  label="Amount to deposit"
                  name="amount"
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />

                <div className="flex justify-between" style={{ margin: "16px 0 24px" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    Asset: USDC
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setAmount(fakeBalance.toString())}
                  >
                    MAX
                  </button>
                </div>

                <SubmitButton
                  loading={isProcessing === "deposit"}
                  disabled={!walletAddress || isBusy || !isAmountValid}
                  label="Approve & Deposit"
                  loadingLabel="Processing Transaction..."
                />
              </form>
            </TabsContent>

            <TabsContent value="withdraw">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void runTransaction("withdraw");
                }}
              >
                <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                    Withdraw amount
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    Balance:{" "}
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                      {walletAddress ? balanceLabel : "0.00"}
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
                {formattedApy}
              </div>
            </div>
          </div>

          <div
            style={{
              height: "1px",
              background: "var(--border-glass)",
              margin: "24px 0",
            }}
          />

          <div
            className="vault-stats-meta flex gap-xl"
            style={{ marginBottom: "32px" }}
          >
            <div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
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
                  <Activity
                    size={10}
                    className={isLoading ? "animate-pulse" : undefined}
                  />
                  {isLoading ? "Syncing" : "Live"}
                </span>
              </div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                }}
              >
                {formattedTvl}
              </div>
            </div>
            <div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  marginBottom: "4px",
                }}
              >
                Underlying Asset
              </div>
              <div className="flex items-center gap-sm">
                <ShieldCheck size={16} color="var(--accent-cyan)" />
                <span style={{ fontSize: "1.1rem", fontWeight: 500 }}>
                  {summary.assetLabel}
                </span>
              </div>
            </div>
          </div>

          <div
            className="glass-panel"
            style={{ padding: "20px", background: "var(--bg-muted)" }}
          >
            <h3
              style={{
                fontSize: "1.1rem",
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <TrendingUp size={18} color="var(--accent-purple)" />
              Strategy Overview
            </h3>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
                lineHeight: "1.6",
              }}
            >
              This vault pools USDC and deploys it into verified tokenized
              sovereign bonds available on the Stellar network. Yields are
              algorithmically harvested and auto-compounded daily into the vault
              token price.
            </p>
            <div
              style={{
                marginTop: "12px",
                color: "var(--text-secondary)",
                fontSize: "0.82rem",
              }}
            >
              Strategy:{" "}
              <span style={{ color: "var(--text-primary)" }}>
                {strategy.name}
              </span>{" "}
              ({strategy.issuer})
            </div>
            <div
              className="copy-field"
              style={{
                marginTop: "8px",
                color: "var(--text-secondary)",
                fontSize: "0.78rem",
              }}
            >
              <span>Strategy ID:</span>
              <span className="copy-field-value copy-field-value-mono">
                {strategy.id}
              </span>
              <CopyButton
                value={strategy.id}
                label="strategy ID"
                successDescription="The strategy ID has been copied to your clipboard."
              />
            </div>
            <div
              style={{
                marginTop: "8px",
                color: "var(--text-secondary)",
                fontSize: "0.78rem",
              }}
            >
              RPC: {hasCustomRpcConfig ? "Custom" : "Default"} -{" "}
              {networkConfig.rpcUrl}
            </div>
        </div>
      </div>

      <div className="vault-dashboard-chart">
        <div className="glass-panel vault-chart-panel">
          <VaultPerformanceChart />
        </div>
      </div>

      <div className="vault-dashboard-actions">
        <div
          className="glass-panel"
          style={{ padding: "32px", position: "relative", overflow: "hidden" }}
        >
          <div
            style={{
              position: "absolute",
              top: "-50px",
              right: "-50px",
              width: "150px",
              height: "150px",
              background: "var(--accent-purple)",
              filter: "blur(80px)",
              opacity: 0.2,
              borderRadius: "50%",
              pointerEvents: "none",
            }}
          />

          {!walletAddress && (
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
              <WalletIcon
                size={48}
                color="var(--accent-cyan)"
                style={{ marginBottom: "16px", opacity: 0.8 }}
              />
              <h3 style={{ marginBottom: "8px" }}>Wallet Not Connected</h3>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.9rem",
                  marginBottom: "24px",
                }}
              >
                Please connect your Freighter wallet to deposit USDC and earn
                RWA yields.
              </p>
            </div>
          )}

          <Tabs
            value={activeTab}
            defaultValue="deposit"
            onValueChange={(value) => {
              setActiveTab(value as "deposit" | "withdraw");
              setAmount("");
            }}
          >
            <TabsList style={{ marginBottom: "24px" }}>
              <TabsTrigger value="deposit">Deposit</TabsTrigger>
              <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            </TabsList>

            {(["deposit", "withdraw"] as const).map((tab) => (
              <TabsContent key={tab} value={tab}>
                <div style={{ marginBottom: "24px" }}>
                  <div
                    className="flex justify-between items-center"
                    style={{ marginBottom: "16px" }}
                  >
                    <div
                <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                    {tab === "deposit" ? "Amount to deposit" : "Amount to withdraw"}
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    Balance: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                      {walletAddress ? availableBalance.toFixed(2) : "0.00"}
                    </span>
                  </div>
                </div>

                <FormField
                  label="Amount to withdraw"
                  name="amount"
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />

                <div className="flex justify-between" style={{ margin: "16px 0 24px" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    Asset: USDC
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setAmount(fakeBalance.toString())}
                  >
                    MAX
                  </button>
                </div>

                <SubmitButton
                  loading={isProcessing === "withdraw"}
                  disabled={!walletAddress || isBusy || !isAmountValid}
                  label="Withdraw Funds"
                  loadingLabel="Processing Transaction..."
                />
              </form>
            </TabsContent>
                <div className="input-group" style={{ marginBottom: "24px" }}>
                  <div className="input-wrapper">
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {tab === "deposit"
                        ? "Amount to deposit"
                        : "Amount to withdraw"}
                    </div>
                    <div
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "0.85rem",
                      }}
                    >
                      Balance:{" "}
                      <span
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: 600,
                        }}
                      >
                        {walletAddress ? availableBalance.toFixed(2) : "0.00"}
                      </span>
                    </div>
                  </div>

                  <div className="input-group">
                    <div className="input-wrapper">
                      <span
                        style={{
                          color: "var(--text-secondary)",
                          paddingRight: "12px",
                          borderRight: "1px solid var(--border-glass)",
                          marginRight: "16px",
                        }}
                      >
                        USDC
                      </span>
                      <input
                        className="input-field"
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={isProcessing !== null}
                      />
                      <button
                        style={{
                          color: "var(--accent-cyan)",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          background: "var(--accent-cyan-dim)",
                          padding: "4px 10px",
                          borderRadius: "6px",
                          border: "none",
                          cursor: "pointer",
                        }}
                        onClick={() => setAmount(availableBalance.toFixed(2))}
                        disabled={
                          !walletAddress ||
                          availableBalance <= 0 ||
                          isProcessing !== null
                        }
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  <div
                    className="flex justify-between items-center"
                    style={{ marginTop: "16px" }}
                  >
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "0.9rem",
                      }}
                    >
                      Network Fee
                    </span>
                    <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                      {summary.networkFeeEstimate}
                    </span>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: "100%", padding: "16px", fontSize: "1.1rem" }}
                  onClick={() => handleTransaction(tab)}
                  disabled={
                    isProcessing !== null || !amount || Number(amount) <= 0
                  }
                >
                  {isProcessing === tab
                    ? "Processing..."
                    : tab === "deposit"
                      ? "Approve & Deposit"
                      : "Withdraw Funds"}
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
