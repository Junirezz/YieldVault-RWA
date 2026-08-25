import React, { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ArrowUpRight, Clock3, Menu, X, AlertTriangle } from "lucide-react";
import {
  Activity,
  AlertCircle,
  Check,
  Share2,
  ShieldCheck,
  TrendingUp,
  Wallet as WalletIcon,
} from "./icons";
import Skeleton, { DashboardCardSkeleton, SkeletonText, SkeletonCircle } from "./Skeleton";
import { useDelayedLoading } from "../hooks/useDelayedLoading";
import { useVault } from "../context/VaultContext";
import ApiStatusBanner from "./ApiStatusBanner";
import SharePriceDisplay from "./SharePriceDisplay";
import VaultPerformanceChart from "./VaultPerformanceChart";
import { useToast } from "../context/ToastContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { FormField } from "../forms";
import { isApiError, isValidationError } from "../lib/api";
import { useForm } from "../forms/useForm";
import { validate, type ValidationSchema } from "../forms/validate";
import { useDepositMutation, useWithdrawMutation } from "../hooks/useVaultMutations";
import { useTokenAllowance } from "../hooks/useTokenAllowance";
import { usePortfolioHoldings } from "../hooks/usePortfolioData";
import { createDepositFormSchema, MIN_DEPOSIT_AMOUNT } from "../forms/schemas/depositFormSchema";
import { createWithdrawFormSchema } from "../forms/schemas/withdrawFormSchema";
import { mapServerError } from "../lib/errorMappers";
import confetti from "canvas-confetti";
import CopyButton from "./CopyButton";
import { Button } from "./ui/Button";
import { copyTextToClipboard } from "../lib/clipboard";
import { useFeeEstimate } from "../hooks/useFeeEstimate";
import { useSlippage } from "../hooks/useSlippage";
import HelpIcon from "./ui/HelpIcon";
import EmptyState from "./ui/EmptyState";
import { useTranslation } from "../i18n";
import { useNavigate } from "react-router-dom";
import { triggerDepositIntent } from "../lib/vaultIntentActions";
import { networkConfig } from "../config/network";
import { useDashboardUrlState, type TransactionTab, type TransactionStep } from "../hooks/useDashboardUrlState";
import RefreshControl from "./RefreshControl";
import { usePolling } from "../hooks/usePolling";
import { useStaleIndicator } from "../hooks/useStaleIndicator";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useTransactionConfirmation } from "../hooks/useTransactionConfirmation";
import { useOfflineRetryCountdown } from "../hooks/useOfflineRetryCountdown";
import { useFormFocusFlow } from "../hooks/useFormFocusFlow";
import { useStaleSubmissionGuard } from "../hooks/useStaleSubmissionGuard";
import { useTransactionIntent } from "../hooks/useTransactionIntent";
import { saveVaultFormDraft, clearVaultFormDraft } from "../lib/formDraftStorage";
import { buildDepositSummary, buildWithdrawalSummary } from "../lib/transactionConfirmationBuilder";
import TransactionConflictResolver from "./TransactionConflictResolver";
import RiskSummaryCard, { type RiskAction } from "./RiskSummaryCard";
import {
  isTransactionConflict,
  type TransactionConflictDetails,
  type TransactionConflictResolution,
} from "../lib/transactionConflict";
import type { StaleFieldChange } from "../lib/staleSubmissionDetection";
import { t } from "../i18n";
import { useTransactionHistory } from "../hooks/useTransactionData";
import TransactionTimeline, { type TxTimelineStatus } from "./TransactionTimeline";
import Badge from "./Badge";

const FIRST_DEPOSIT_PREFIX = "yieldvault:first-deposit:";
const MAX_TRANSACTION_RETRY_ATTEMPTS = 3;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function runDepositConfetti(): void {
  if (prefersReducedMotion()) {
    return;
  }

  const end = Date.now() + 2000;
  const intervalId = window.setInterval(() => {
    confetti({
      particleCount: 28,
      spread: 72,
      startVelocity: 34,
      gravity: 1.05,
      ticks: 90,
      origin: { x: Math.random() * 0.6 + 0.2, y: 0.6 },
      colors: ["#00f0ff", "#a855f7", "#ffffff", "#3b82f6"],
    });

    if (Date.now() > end) {
      window.clearInterval(intervalId);
    }
  }, 220);
}

/**
 * Visual indicator for the 3-step transaction wizard.
 * Shows progress through Amount, Review, and Result stages.
 */
const StepIndicator: React.FC<{ currentStep: TransactionStep }> = ({ currentStep }) => {
  const steps: Array<{ id: TransactionStep; label: string }> = [
    { id: "amount", label: t("vaultDashboard.steps.amount") },
    { id: "review", label: t("vaultDashboard.steps.review") },
    { id: "result", label: t("vaultDashboard.steps.result") },
  ];
  const stepOrder: TransactionStep[] = ["amount", "review", "result"];
  const currentIndex = stepOrder.indexOf(currentStep);

  return (
    <div className="step-indicator-container">
      {steps.map((step, index) => {
        const status =
          index < currentIndex
            ? "completed"
            : index === currentIndex
              ? "active"
              : "pending";

        return (
          <React.Fragment key={step.id}>
            <div className={`step-item ${status}`}>
              <div className="step-number">
                {status === "completed" ? <Check size={12} /> : index + 1}
              </div>
              <span className="step-label">{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div className={`step-line ${status === "completed" ? "completed" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

interface VaultDashboardProps {
  walletAddress: string | null;
  usdcBalance?: number;
  xlmBalance?: number;
}

const VaultCapWarning: React.FC<{ utilization: number; isReached: boolean }> = ({
  utilization,
  isReached,
}) => {
  const percent = (utilization * 100).toFixed(1);

  return (
    <div
      className="glass-panel"
      style={{
        padding: "16px",
        marginBottom: "24px",
        border: `1px solid ${isReached ? "var(--text-error)" : "var(--text-warning)"}`,
        background: isReached ? "rgba(255, 69, 58, 0.1)" : "rgba(255, 159, 10, 0.1)",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
      }}
    >
      {isReached ? (
        <AlertCircle color="var(--text-error)" size={20} />
      ) : (
        <AlertCircle color="var(--text-warning)" size={20} />
      )}
      <div>
        <div
          style={{
            fontWeight: 600,
            color: isReached ? "var(--text-error)" : "var(--text-warning)",
            marginBottom: "4px",
          }}
        >
          {isReached ? t("vaultDashboard.capWarning.reached") : t("vaultDashboard.capWarning.near")}
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            lineHeight: "1.4",
          }}
        >
          {isReached
            ? t("vaultDashboard.capWarning.reachedDesc").replace("{{percent}}", percent)
            : t("vaultDashboard.capWarning.nearDesc").replace("{{percent}}", percent)}
        </div>
      </div>
    </div>
  );
};

const VaultDashboard: React.FC<VaultDashboardProps> = ({
  walletAddress,
  usdcBalance = 0,
  xlmBalance = 0,
}) => {
  const navigate = useNavigate();
  const dashboardUrl = useDashboardUrlState();
  const {
    formattedTvl,
    formattedApy,
    summary,
    error,
    isLoading,
    summaryUnavailable,
    utilization,
    isCapWarning,
    isCapReached,
    lastUpdate,
    strategySwitchCooldownRemaining,
    refresh,
  } = useVault();
  const { t } = useTranslation();
  const toast = useToast();
  const delayedLoading = useDelayedLoading(isLoading);

  const statsPolling = usePolling(refresh, {
    interval: 30000,
    pauseOnHidden: true,
    pauseOnOffline: true,
  });
  const { isStale: statsIsStale, ageText: statsAgeText } = useStaleIndicator(lastUpdate);

  const { data: portfolioHoldings } = usePortfolioHoldings(walletAddress);

  // Deposit balance comes from the connected wallet's USDC balance; withdraw
  // balance is the user's current vault position (sum of holdings value).
  const depositBalance = walletAddress ? usdcBalance : 0;
  const withdrawBalance = walletAddress
    ? (portfolioHoldings ?? []).reduce((sum, holding) => sum + holding.valueUsd, 0)
    : 0;
  const availableBalance =
    dashboardUrl.state.tab === "deposit" ? depositBalance : withdrawBalance;

  // Wizard state
  const [transactionResult, setTransactionResult] = useState<{
    success: boolean;
    message: string;
    txHash?: string;
    retryable?: boolean;
    actionType?: TransactionTab;
  } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [activeConflict, setActiveConflict] = useState<{
    conflict: TransactionConflictDetails;
    staleChanges?: StaleFieldChange[];
  } | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);
  const [txTimelineStatus, setTxTimelineStatus] = useState<TxTimelineStatus>("preparing");

  const { data: transactions } = useTransactionHistory(walletAddress);
  const { data: holdings } = usePortfolioHoldings(walletAddress);

  const { isOffline, countdown } = useOfflineRetryCountdown();

  const depositMutation = useDepositMutation();
  const withdrawMutation = useWithdrawMutation();
  const { approvalStatus, needsApproval, approve, resetApproval } =
    useTokenAllowance(walletAddress);
  
  // Transaction confirmation modal
  const confirmation = useTransactionConfirmation();

  const { isOnline } = useNetworkStatus();
  const { feeXlm, isEstimating, isHighFee, lastUpdated: feeLastUpdated } = useFeeEstimate(
    walletAddress,
    "",
    dashboardUrl.state.tab,
    isOnline
  );

  const { slippage, setSlippage, presets, isHighSlippage, minReceived } = useSlippage();
  const [customSlippage, setCustomSlippage] = useState("");
  const { isStale: feeIsStale, ageText: feeAgeText } = useStaleIndicator(feeLastUpdated);

  // Create validation schema based on transaction type and current state
  const transactionSchema = React.useMemo<ValidationSchema<{ amount: string }>>(() => {
    if (dashboardUrl.state.tab === "deposit") {
      return createDepositFormSchema(depositBalance, isCapReached, xlmBalance, feeXlm);
    } else {
      return createWithdrawFormSchema(withdrawBalance, xlmBalance, feeXlm);
    }
  }, [dashboardUrl.state.tab, depositBalance, withdrawBalance, isCapReached, xlmBalance, feeXlm]);

  const {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    setValues,
    setFieldError,
    resetErrors,
    validateAll,
  } = useForm({ amount: dashboardUrl.state.amount }, transactionSchema);

  // Validation computed against the full schema regardless of touched state,
  // so the primary CTA can be disabled proactively (before the user blurs
  // the field) instead of only reacting to already-surfaced inline errors.
  const liveValidationErrors = React.useMemo(
    () => validate(transactionSchema, values),
    [transactionSchema, values],
  );

  const amount = values.amount;
  const activeTab = dashboardUrl.state.tab;
  const activeStep = dashboardUrl.state.step;
  const amountFieldId = `vault-${activeTab}-amount`;

  const formFocus = useFormFocusFlow({
    fields: [
      { id: amountFieldId, hasError: Boolean(touched.amount && errors.amount) },
      { id: `vault-${activeTab}-max` },
      { id: `vault-${activeTab}-review` },
    ],
    focusKey: `${activeTab}:${activeStep}`,
    autoFocusOnKeyChange: activeStep === "amount",
  });

  useEffect(() => {
    if (!walletAddress) return;
    if (!amount.trim() && dashboardUrl.state.step === "amount") return;

    saveVaultFormDraft({
      tab: dashboardUrl.state.tab,
      step: dashboardUrl.state.step,
      amount,
    });
  }, [
    walletAddress,
    dashboardUrl.state.tab,
    dashboardUrl.state.step,
    amount,
  ]);

  // Handle deep link parameters
  useEffect(() => {
    const action = dashboardUrl.state.tab;
    const amountParam = dashboardUrl.state.amount;

    if (action !== "deposit") {
      return;
    }

    const parsedAmount = amountParam === "" ? Number.NaN : Number(amountParam);
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      setValues({ amount: parsedAmount.toString() });
    }
  }, [dashboardUrl.state.tab, dashboardUrl.state.amount, setValues]);

  const previousTabRef = useRef(dashboardUrl.state.tab);
  useEffect(() => {
    if (previousTabRef.current === dashboardUrl.state.tab) {
      return;
    }
    previousTabRef.current = dashboardUrl.state.tab;
    if (!dashboardUrl.state.amount) {
      setValues({ amount: "" });
    }
    resetApproval();
    resetErrors();
  }, [dashboardUrl.state.tab, dashboardUrl.state.amount, setValues, resetApproval, resetErrors]);

  // Reset approval when deposit amount changes
  useEffect(() => {
    resetApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  useEffect(() => {
    const handleDeposit = () => {
      dashboardUrl.setTab("deposit");
      setTimeout(() => {
        const input = document.querySelector(".input-field") as HTMLInputElement | null;
        if (input) input.focus();
      }, 0);
    };
    const handleWithdraw = () => {
      dashboardUrl.setTab("withdraw");
      setTimeout(() => {
        const input = document.querySelector(".input-field") as HTMLInputElement | null;
        if (input) input.focus();
      }, 0);
    };
    window.addEventListener("TRIGGER_DEPOSIT", handleDeposit);
    window.addEventListener("TRIGGER_WITHDRAW", handleWithdraw);
    return () => {
      window.removeEventListener("TRIGGER_DEPOSIT", handleDeposit);
      window.removeEventListener("TRIGGER_WITHDRAW", handleWithdraw);
    };
  }, [dashboardUrl]);

  const isProcessing = depositMutation.isPending
    ? "deposit"
    : withdrawMutation.isPending
      ? "withdraw"
      : null;
  const isBusy = isProcessing !== null;

  const strategy = summary.strategy;
  const enteredAmount = Number(amount);
  const activeAmountError = errors.amount;
  const isValidAmount = !activeAmountError;
  const showInlineError = touched.amount && Boolean(activeAmountError);
  const managementFeeBps = 35;
  const estimatedFee = isValidAmount
    ? (enteredAmount * managementFeeBps) / 10_000
    : 0;
  const estimatedNetAmount = isValidAmount
    ? Math.max(enteredAmount - estimatedFee, 0)
    : 0;
  const isSubmitDisabled =
    !walletAddress ||
    isBusy ||
    !amount ||
    Object.keys(liveValidationErrors).length > 0 ||
    (dashboardUrl.state.tab === "deposit" && isCapReached);

  const riskItems = React.useMemo<RiskAction[]>(() => {
    const next: RiskAction[] = [];

    if (!walletAddress) {
      next.push({
        id: "wallet",
        title: t("vaultDashboard.riskSummary.wallet.title"),
        description: t("vaultDashboard.riskSummary.wallet.desc"),
        label: t("vaultDashboard.riskSummary.wallet.cta"),
        tone: "info",
        onClick: () => window.dispatchEvent(new Event("TRIGGER_WALLET_CONNECT")),
      });
    }

    if (isCapReached) {
      next.push({
        id: "cap-reached",
        title: t("vaultDashboard.riskSummary.capReached.title"),
        description: t("vaultDashboard.riskSummary.capReached.desc"),
        label: t("vaultDashboard.riskSummary.capReached.cta"),
        tone: "critical",
        onClick: () => navigate("/compare"),
      });
    } else if (isCapWarning) {
      next.push({
        id: "cap-warning",
        title: t("vaultDashboard.riskSummary.capWarning.title"),
        description: t("vaultDashboard.riskSummary.capWarning.desc"),
        label: t("vaultDashboard.riskSummary.capWarning.cta"),
        tone: "warning",
        onClick: () => navigate("/compare"),
      });
    }

    if (xlmBalance < feeXlm) {
      next.push({
        id: "xlm-fee",
        title: t("vaultDashboard.riskSummary.xlmFee.title"),
        description: t("vaultDashboard.riskSummary.xlmFee.desc"),
        label: t("vaultDashboard.riskSummary.xlmFee.cta"),
        tone: "warning",
        onClick: () => {
          dashboardUrl.setTab("deposit");
          dashboardUrl.setStep("amount");
          window.dispatchEvent(new Event("TRIGGER_DEPOSIT"));
        },
      });
    }

    if (summary.contractPaused) {
      next.push({
        id: "contract-paused",
        title: t("vaultDashboard.riskSummary.paused.title"),
        description: t("vaultDashboard.riskSummary.paused.desc"),
        label: t("vaultDashboard.riskSummary.paused.cta"),
        tone: "critical",
        onClick: refresh,
      });
    }

    const recentFailedTx = (transactions || []).find(tx => tx.status === "failed");
    if (recentFailedTx) {
      next.push({
        id: "failed-tx",
        title: t("vaultDashboard.riskSummary.failedTx.title"),
        description: t("vaultDashboard.riskSummary.failedTx.desc"),
        label: t("vaultDashboard.riskSummary.failedTx.cta"),
        tone: "warning",
        onClick: () => navigate("/transactions"),
      });
    }

    const vaultValue = (holdings || []).find((h) => h.asset === "yvUSDC")?.valueUsd || 0;
    const totalValue = (holdings || []).reduce((sum, h) => sum + h.valueUsd, 0) + availableBalance;
    const isHighExposure = totalValue > 0 && (vaultValue / totalValue) > 0.8;
    
    if (isHighExposure) {
      next.push({
        id: "high-exposure",
        title: t("vaultDashboard.riskSummary.highExposure.title"),
        description: t("vaultDashboard.riskSummary.highExposure.desc"),
        label: t("vaultDashboard.riskSummary.highExposure.cta"),
        tone: "info",
        onClick: () => navigate("/portfolio"),
      });
    }

    return next;
  }, [dashboardUrl, feeXlm, isCapReached, isCapWarning, navigate, refresh, summary.contractPaused, t, walletAddress, xlmBalance, transactions, holdings, availableBalance]);

  const staleGuard = useStaleSubmissionGuard({
    action: dashboardUrl.state.tab,
    amount: enteredAmount,
    availableBalance,
    feeXlm,
    isCapReached,
    slippage,
  });

  const transactionIntent = useTransactionIntent({
    walletAddress,
    action: dashboardUrl.state.tab,
    amount: enteredAmount,
    snapshotHash: staleGuard.snapshotHash,
  });

  const resetWizard = () => {
    setValues({ amount: "" });
    dashboardUrl.setState({ step: "amount", amount: "" });
    clearVaultFormDraft();
    setTransactionResult(null);
    setRetryCount(0);
    setActiveConflict(null);
    staleGuard.clearReviewSnapshot();
    clearVaultFormDraft();
    if (walletAddress) {
      transactionIntent.clearIntent();
    }
  };

  const goToReview = () => {
    if (!validateAll()) {
      toast.warning({
        title: t("vaultDashboard.toast.validationErrorTitle"),
        description: liveValidationErrors.amount || t("vaultDashboard.toast.invalidAmount"),
      });
      formFocus.focusFirstError();
      return;
    }

    staleGuard.captureReviewSnapshot();
    dashboardUrl.setStep("review");
    window.setTimeout(() => {
      document.getElementById(`vault-${activeTab}-confirm`)?.focus();
    }, 0);
  };

  const executeTransaction = async (
    actionType: TransactionTab,
    options: { skipStaleCheck?: boolean; isRetry?: boolean } = {},
  ) => {
    const value = Number(amount);

    if (!walletAddress) {
      toast.warning({
        title: t("vaultDashboard.toast.walletRequiredTitle"),
        description: t("vaultDashboard.toast.walletRequiredDesc"),
      });
      return;
    }

    if (!options.isRetry) {
      setRetryCount(0);
    }

    if (!options.skipStaleCheck) {
      const staleResult = staleGuard.checkStaleSubmission();
      if (staleResult.isStale) {
        setActiveConflict({
          conflict: {
            type: "stale-form",
            message:
              t("vaultDashboard.toast.staleFormMessage"),
          },
          staleChanges: staleResult.changes,
        });
        return;
      }

      if (transactionIntent.intentIsStale) {
        setActiveConflict({
          conflict: {
            type: "stale-form",
            message:
              t("vaultDashboard.toast.staleIntentMessage"),
          },
        });
        return;
      }
    }

    setActiveConflict(null);

    try {
      const contractAddress = networkConfig.contractId;
      let summary;

      if (actionType === "deposit") {
        summary = buildDepositSummary({
          amount: value,
          feeXlm,
          contractAddress,
        });
      } else {
        summary = buildWithdrawalSummary({
          amount: value,
          feeXlm,
          contractAddress,
        });
      }

      const confirmed = await confirmation.requestConfirmation(summary);
      if (!confirmed) {
        return;
      }

      dashboardUrl.setStep("result");
      setTxTimelineStatus("preparing");

      const intent = transactionIntent.ensureIntent();
      const mutationParams = {
        walletAddress,
        amount: value,
        idempotencyKey: intent?.idempotencyKey,
      };

      setTxTimelineStatus("submitting");

      let submittedTxHash: string | undefined;

      if (actionType === "deposit") {
        const depositResult = await depositMutation.mutateAsync(mutationParams);

        try {
          const depositKey = `${FIRST_DEPOSIT_PREFIX}${walletAddress}`;
          const alreadyCelebrated = localStorage.getItem(depositKey) === "true";
          if (!alreadyCelebrated) {
            localStorage.setItem(depositKey, "true");
            runDepositConfetti();
          }
        } catch (storageErr) {
          console.warn("Storage access failed while tracking first deposit state", storageErr);
          runDepositConfetti();
        }

        submittedTxHash = depositResult?.txHash;
      } else {
        const withdrawResult = await withdrawMutation.mutateAsync(mutationParams);
        submittedTxHash = withdrawResult?.txHash;
      }

      transactionIntent.clearIntent();
      staleGuard.refreshSnapshot();
      setRetryCount(0);

      setTransactionResult({
        success: true,
        message: actionType === "deposit"
          ? t("vaultDashboard.depositMessage").replace("{{amount}}", value.toFixed(2))
          : t("vaultDashboard.withdrawMessage").replace("{{amount}}", value.toFixed(2)),
        txHash: submittedTxHash,
      });
      setTxTimelineStatus("finalized");

      toast.success({
        title: actionType === "deposit" ? t("vaultDashboard.toast.depositSuccessTitle") : t("vaultDashboard.toast.withdrawalSuccessTitle"),
        description:
          actionType === "deposit"
            ? t("vaultDashboard.depositMessage").replace("{{amount}}", value.toFixed(2))
            : t("vaultDashboard.withdrawMessage").replace("{{amount}}", value.toFixed(2)),
      });
    } catch (err: unknown) {
      if (isTransactionConflict(err)) {
        setActiveConflict({
          conflict: err.conflict,
        });
        dashboardUrl.setStep("review");
        return;
      }

      setTxTimelineStatus("failed");

      const mappedError = mapServerError(err);
      const hasFieldErrors = mappedError.fieldErrors.length > 0;

      if (hasFieldErrors) {
        mappedError.fieldErrors.forEach(({ fieldName, message }) => {
          setFieldError(fieldName as keyof { amount: string }, message);
        });
        dashboardUrl.setStep("amount");
      }

      let errorMessage = t("vaultDashboard.toast.genericError");

      if (isValidationError(err)) {
        errorMessage = err.details?.[0]?.message || errorMessage;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else if (mappedError.generalError) {
        errorMessage = mappedError.generalError;
      }

      // Field-level validation failures need corrected input, not a blind resubmit.
      // Everything else (network hiccups, RPC timeouts, transient 5xx) is worth retrying.
      const retryable =
        !hasFieldErrors && !isValidationError(err) && (isApiError(err) ? err.retryable : true);

      if (options.isRetry) {
        setRetryCount((count) => count + 1);
      }

      setTransactionResult({
        success: false,
        message: errorMessage,
        retryable,
        actionType,
      });

      toast.error({
        title: t("vaultDashboard.toast.transactionFailedTitle"),
        description: errorMessage,
      });
    }
  };

  const handleConflictResolution = async (
    resolution: TransactionConflictResolution,
  ) => {
    if (!activeConflict) {
      return;
    }

    setIsResolvingConflict(true);

    try {
      if (resolution === "dismiss") {
        setActiveConflict(null);
        return;
      }

      if (resolution === "update-values") {
        staleGuard.refreshSnapshot();
        transactionIntent.refreshIntent();
        setActiveConflict(null);
        return;
      }

      if (resolution === "new-intent") {
        transactionIntent.rotateIntent();
        setActiveConflict(null);
        await executeTransaction(dashboardUrl.state.tab, { skipStaleCheck: true });
        return;
      }

      if (
        resolution === "proceed-anyway" ||
        resolution === "retry" ||
        resolution === "retry-same"
      ) {
        setActiveConflict(null);
        await executeTransaction(dashboardUrl.state.tab, { skipStaleCheck: true });
      }
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const handleTransaction = async (actionType: TransactionTab) => {
    await executeTransaction(actionType);
  };

  const canRetryTransaction =
    transactionResult?.success === false &&
    transactionResult.retryable !== false &&
    retryCount < MAX_TRANSACTION_RETRY_ATTEMPTS;

  const retryTransaction = async () => {
    if (!transactionResult || retryCount >= MAX_TRANSACTION_RETRY_ATTEMPTS) {
      return;
    }
    const actionType = transactionResult.actionType ?? dashboardUrl.state.tab;
    await executeTransaction(actionType, { skipStaleCheck: true, isRetry: true });
  };

  return (
    <div className="vault-dashboard gap-lg">
      {/* Transaction Confirmation Modal - shown for all sensitive actions */}
      {confirmation.modal}
      
      <div className="vault-dashboard-stats" aria-busy={delayedLoading}>
        <div className="glass-panel vault-stats-panel">
          {error && (
            <ApiStatusBanner error={{ ...error, userMessage: t("vaultDashboard.failedToLoad") }} />
          )}
          <div className="vault-stats-header flex justify-between items-center" style={{ marginBottom: "24px" }}>
            <div>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "4px" }}>
                {delayedLoading ? <SkeletonText width="240px" lineHeight="1.5rem" /> : t("vaultDashboard.fundName")}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {delayedLoading ? (
                  <SkeletonText width="100px" lineHeight="1.5rem" />
                ) : (
                  <>
                    <span
                      className="tag"
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t("vaultDashboard.tokens")}
                    </span>
                    <SharePriceDisplay />
                  </>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                {t("vaultDashboard.currentApy")}
                <HelpIcon
                  variant="tooltip"
                  content={t("vaultDashboard.apyTooltip")}
                />
                <Badge
                  variant="pill"
                  color={statsIsStale ? "warning" : "cyan"}
                  size="compact"
                  icon={<Clock3 size={10} />}
                  style={{ marginLeft: "4px", whiteSpace: "nowrap" }}
                >
                  {statsIsStale
                    ? t("vaultDashboard.staleAge").replace("{{age}}", statsAgeText || "").trim()
                    : statsAgeText
                      ? t("vaultDashboard.freshAge").replace("{{age}}", statsAgeText)
                      : t("vaultDashboard.live")}
                </Badge>
              </div>
              <div className="text-gradient" style={{ fontSize: "2rem", fontFamily: "var(--font-display)", fontWeight: 700 }}>
                {delayedLoading ? <Skeleton width="100px" height="2.5rem" /> : formattedApy}
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

          {/* Per-widget refresh control + stale indicator for stats panel */}
          <div style={{ marginBottom: "16px" }}>
            <RefreshControl
              isPolling={statsPolling.isPolling}
              isPaused={statsPolling.isPaused}
              pauseReason={statsPolling.pauseReason}
              onPause={statsPolling.pause}
              onResume={statsPolling.resume}
              onRefresh={statsPolling.forceRefresh}
              isRefetching={isLoading}
              lastUpdated={lastUpdate}
            />
            {statsIsStale && statsAgeText && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: "6px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.75rem",
                  color: "var(--text-warning, #f59e0b)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-warning, #f59e0b)", flexShrink: 0 }} />
                {t("vaultDashboard.dataMayBeStale").replace("{{age}}", statsAgeText)}
              </div>
            )}
          </div>

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
                {t("vaultDashboard.totalValueLocked")}
                <span
                  className="flex items-center gap-xs"
                  style={{
                    color: isOffline ? "rgba(255, 159, 10, 0.9)" : "var(--accent-cyan)",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {!isOffline && <Activity size={10} className={isLoading ? "animate-pulse" : undefined} />}
                  {isOffline ? t("vaultDashboard.retrying").replace("{{seconds}}", String(countdown)) : isLoading ? t("vaultDashboard.syncing") : t("vaultDashboard.live")}
                </span>
              </div>
              <div style={{ fontSize: "1.25rem", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                {delayedLoading ? <Skeleton width="140px" height="1.5rem" /> : formattedTvl}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}>
                {t("vaultDashboard.underlyingAsset")}
              </div>
              <div className="flex items-center gap-sm">
                {delayedLoading ? (
                  <>
                    <SkeletonCircle width={16} height={16} />
                    <SkeletonText width="100px" lineHeight="1.1rem" />
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} color="var(--accent-cyan)" />
                    <span style={{ fontSize: "1.1rem", fontWeight: 500 }}>{summary.assetLabel}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <RiskSummaryCard
            items={riskItems}
            title={t("vaultDashboard.riskSummary.title")}
            subtitle={t("vaultDashboard.riskSummary.subtitle")}
            allClearLabel={t("vaultDashboard.riskSummary.allClear")}
            warningsLabel={
              riskItems.length === 1
                ? t("vaultDashboard.riskSummary.warningCountOne")
                : t("vaultDashboard.riskSummary.warningCount").replace("{{count}}", String(riskItems.length))
            }
            healthyMessage={t("vaultDashboard.riskSummary.healthyMessage")}
            healthyAction={{
              label: t("vaultDashboard.riskSummary.healthyCta"),
              onClick: () => navigate("/compare"),
            }}
          />

          <div className="glass-panel" style={{ padding: "20px", background: "var(--bg-muted)" }}>
            {delayedLoading ? (
              <DashboardCardSkeleton />
            ) : summaryUnavailable ? (
              <>
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
                  {t("vaultDashboard.strategyOverview")}
                </h3>
                <EmptyState
                  kind="error"
                  title={t("vaultDashboard.strategyUnavailableTitle")}
                  description={t("vaultDashboard.strategyUnavailableDesc")}
                  icon={<TrendingUp size={24} />}
                  action={{
                    label: t("common.retry"),
                    onClick: () => void refresh(),
                  }}
                  secondaryAction={{
                    label: t("emptyState.compareStrategies"),
                    href: "/compare",
                    variant: "secondary",
                  }}
                />
              </>
            ) : (
              <>
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
              {t("vaultDashboard.strategyOverview")}
            </h3>
            <div
              style={{
                marginBottom: "12px",
                color: "var(--text-secondary)",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              {t("vaultDashboard.strategyName")}
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: "1.6" }}>
              {t("vaultDashboard.strategyDesc")}
            </p>
            <div className="flex gap-md" style={{ marginTop: "14px", flexWrap: "wrap" }}>
              <div
                style={{
                  flex: "1 1 150px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-glass)",
                }}
              >
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>
                  {t("vaultDashboard.targetAllocation")}
                </div>
                <div style={{ fontWeight: 600 }}>{t("vaultDashboard.treasuriesPercent")}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>{t("vaultDashboard.cashReservePercent")}</div>
              </div>
              <div
                style={{
                  flex: "1 1 150px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-glass)",
                }}
              >
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>
                  {t("vaultDashboard.yieldDistribution")}
                </div>
                <div style={{ fontWeight: 600 }}>{t("vaultDashboard.dailyCompounding")}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                  {t("vaultDashboard.navReflection")}
                </div>
              </div>
              <div
                style={{
                  flex: "1 1 150px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-glass)",
                }}
              >
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>
                  {t("vaultDashboard.riskControls")}
                </div>
                <div style={{ fontWeight: 600 }}>{t("vaultDashboard.issuerDurationCaps")}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                  {t("vaultDashboard.rebalancedEpoch")}
                </div>
              </div>
            </div>
            <div style={{ marginTop: "12px", color: "var(--text-secondary)", fontSize: "0.82rem" }}>
              {t("vaultDashboard.strategyLabel")} <span style={{ color: "var(--text-primary)" }}>{strategy.name}</span> ({strategy.issuer})
            </div>
            <div
              className="copy-field"
              style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "0.78rem" }}
            >
              <span>{t("vaultDashboard.strategyIdLabel")}</span>
              <span className="copy-field-value copy-field-value-mono">{strategy.id}</span>
              <CopyButton value={strategy.id} label="strategy ID" />
            </div>
            {strategySwitchCooldownRemaining > 0 && (
              <div
                style={{
                  marginTop: "8px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(234, 179, 8, 0.1)",
                  border: "1px solid rgba(234, 179, 8, 0.3)",
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Clock3 size={14} style={{ color: "#eab308", flexShrink: 0 }} />
                <span>
                  Strategy switch cooldown: {strategySwitchCooldownRemaining}s remaining
                </span>
              </div>
            )}
            <div style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/strategies/${strategy.id}`)}
              >
                {t("vaultDashboard.viewDetails")}
              </button>
            </div>
          </>
            )}
          </div>

          {/* Empty state: wallet connected, loading done, no USDC balance */}
          {!isLoading && walletAddress && usdcBalance === 0 && (
            <EmptyState
              kind="no-data"
              title={t("dashboard.emptyState.noDeposits.title")}
              description={t("dashboard.emptyState.noDeposits.desc")}
              icon={<TrendingUp />}
              actionLabel={t("emptyState.depositNow")}
              onAction={() => triggerDepositIntent(navigate, walletAddress)}
            />
          )}
        </div>
      </div>

      <div className="vault-dashboard-chart">
        <div className="glass-panel vault-chart-panel">
          <VaultPerformanceChart />
        </div>
      </div>

      <div className="vault-dashboard-actions">
        <div
          className="glass-panel vault-actions-panel"
          style={{ position: "relative", overflow: "hidden" }}
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
              className="wallet-overlay"
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
              <h3>{t("vaultDashboard.walletNotConnected")}</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                {t("vaultDashboard.connectPrompt")}
              </p>
            </div>
          )}

          <Tabs
            value={dashboardUrl.state.tab}
            defaultValue="deposit"
            onValueChange={(value) => {
              dashboardUrl.setState({
                tab: value as TransactionTab,
                amount: "",
              });
              setValues({ amount: "" });
            }}
          >
            {dashboardUrl.state.step === "amount" && (
              <TabsList style={{ marginBottom: "24px" }}>
                <TabsTrigger value="deposit">{t("vaultDashboard.tabs.deposit")}</TabsTrigger>
                <TabsTrigger value="withdraw">{t("vaultDashboard.tabs.withdraw")}</TabsTrigger>
              </TabsList>
            )}

            <StepIndicator currentStep={dashboardUrl.state.step} />

            {(["deposit", "withdraw"] as const).map((tab) => {
              const tabBalance = tab === "deposit" ? depositBalance : withdrawBalance;
              return (
              <TabsContent key={tab} value={tab}>
                {(isCapReached || isCapWarning) && tab === "deposit" && (
                  <VaultCapWarning utilization={utilization} isReached={isCapReached} />
                )}

                  <div style={{ minHeight: "380px", display: "flex", flexDirection: "column" }}>
                    {dashboardUrl.state.step === "amount" && (
                      <div
                        ref={formFocus.containerRef}
                        className="animate-in fade-in duration-300"
                        onKeyDown={formFocus.handleFormKeyDown}
                      >
                        <div style={{ marginBottom: "24px" }}>
                          <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                            <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                              {tab === "deposit" ? t("vaultDashboard.amountToDeposit") : t("vaultDashboard.amountToWithdraw")}
                            </div>
                            <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                              {t("vaultDashboard.balanceLabel")} <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{tabBalance.toFixed(2)}</span>
                            </div>
                          </div>

                          <FormField
                            label={tab === "deposit" ? t("vaultDashboard.depositAmountLabel") : t("vaultDashboard.withdrawalAmountLabel")}
                            name="amount"
                            id={tab === activeTab ? amountFieldId : `vault-${tab}-amount`}
                            type="number"
                            step="any"
                            placeholder="0.00"
                            value={amount}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            disabled={isBusy || (tab === "deposit" && isCapReached)}
                            error={showInlineError ? activeAmountError ?? undefined : undefined}
                            helperText={tab === "deposit" ? t("vaultDashboard.minDeposit").replace("{{amount}}", MIN_DEPOSIT_AMOUNT.toFixed(2)) : t("vaultDashboard.maxWithdraw").replace("{{amount}}", tabBalance.toFixed(2))}
                            className={isValidAmount ? "input-valid" : ""}
                          />

                          <div className="flex justify-between items-center" style={{ margin: "16px 0 24px" }}>
                            <div className="flex items-center gap-sm">
                              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>{t("vaultDashboard.assetUsdc")}</span>
                              {tab === "deposit" && (
                                <>
                                  <div style={{ width: "1px", height: "14px", background: "var(--border-glass)", margin: "0 4px" }} />
                                  <button
                                    type="button"
                                    className="btn-link flex items-center gap-xs"
                                    style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", padding: 0 }}
                                    onClick={async () => {
                                      const baseUrl = window.location.origin + window.location.pathname;
                                      const shareUrl = amount && !isNaN(Number(amount)) && Number(amount) > 0
                                        ? `${baseUrl}?action=deposit&amount=${amount}`
                                        : baseUrl;
                                      
                                      try {
                                        await copyTextToClipboard(shareUrl);
                                        toast.success({
                                          title: t("vaultDashboard.toast.linkCopiedTitle"),
                                          description: t("vaultDashboard.toast.linkCopiedDesc")
                                        });
                                      } catch {
                                        toast.error({
                                          title: t("vaultDashboard.toast.copyFailedTitle"),
                                          description: t("vaultDashboard.toast.copyFailedDesc")
                                        });
                                      }
                                    }}
                                  >
                                    <Share2 size={12} />
                                    {t("vaultDashboard.shareLink")}
                                  </button>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              id={`vault-${tab}-max`}
                              className="btn-max"
                              onClick={() => {
                                const nextValues = { amount: tabBalance.toFixed(2) };
                                setValues(nextValues);
                                validateAll(nextValues);
                              }}
                              disabled={
                                !walletAddress ||
                                tabBalance <= 0 ||
                                isBusy ||
                                (tab === "deposit" && isCapReached)
                              }
                            >
                              {t("vaultDashboard.maxButton")}
                            </button>
                          </div>
                        </div>

                        {/* Progressive Disclosure: Fee Breakdown */}
                        {isValidAmount && (
                          <div
                            className="glass-panel animate-in fade-in duration-300"
                            style={{
                              padding: "14px 16px",
                              background: "rgba(0, 0, 0, 0.15)",
                              marginBottom: "16px",
                              border: "1px solid rgba(0, 240, 255, 0.15)",
                            }}
                          >
                            <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                              <Check size={14} color="var(--accent-cyan)" />
                              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                Transaction Preview
                              </span>
                            </div>
                            <div className="flex justify-between items-center" style={{ marginBottom: "6px" }}>
                              <span style={{ color: "var(--text-secondary)", fontSize: "0.86rem", display: "flex", alignItems: "center", gap: "6px" }}>
                                {t("vaultDashboard.estimatedProtocolFee")}
                                <HelpIcon
                                  variant="popover"
                                  content={t("vaultDashboard.protocolFeeTooltip")}
                                />
                              </span>
                              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                                {estimatedFee.toFixed(4)} USDC
                              </span>
                            </div>
                            <div className="flex justify-between items-center" style={{ marginBottom: "6px" }}>
                              <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                                {tab === "deposit" ? t("vaultDashboard.estimatedNetDeposit") : t("vaultDashboard.estimatedNetWithdrawal")}
                              </span>
                              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                                {estimatedNetAmount.toFixed(4)} USDC
                              </span>
                            </div>
                            {tab === "deposit" && (
                              <div className="flex justify-between items-center" style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border-glass)" }}>
                                <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "6px" }}>
                                  Estimated Shares
                                  <HelpIcon
                                    variant="tooltip"
                                    content="Approximate vault shares you'll receive based on current share price"
                                  />
                                </span>
                                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--accent-cyan)" }}>
                                  ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â  {estimatedNetAmount.toFixed(2)} yvUSDC
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Early Warning: Approval Required */}
                        {tab === "deposit" && isValidAmount && needsApproval(enteredAmount) && (
                          <div
                            className="glass-panel animate-in fade-in duration-300"
                            style={{
                              padding: "12px 16px",
                              marginBottom: "16px",
                              border: "1px solid rgba(255, 159, 10, 0.4)",
                              background: "rgba(255, 159, 10, 0.05)",
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <AlertCircle size={16} color="rgba(255, 159, 10, 0.9)" />
                            <div>
                              <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "2px" }}>
                                Approval Required
                              </div>
                              <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                                You'll need to approve USDC spending before depositing
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Vault Capacity Visual Indicator */}
                        {tab === "deposit" && (utilization > 0.7 || isCapReached) && (
                          <div
                            className="glass-panel animate-in fade-in duration-300"
                            style={{
                              padding: "12px 16px",
                              marginBottom: "16px",
                              border: `1px solid ${isCapReached ? "var(--text-error)" : "rgba(255, 159, 10, 0.4)"}`,
                              background: isCapReached ? "rgba(255, 69, 58, 0.05)" : "rgba(255, 159, 10, 0.05)",
                            }}
                          >
                            <div style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                                Vault Capacity
                              </span>
                              <span style={{ fontSize: "0.82rem", fontWeight: 600, color: isCapReached ? "var(--text-error)" : "var(--text-warning)" }}>
                                {(utilization * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div
                              style={{
                                width: "100%",
                                height: "6px",
                                borderRadius: "3px",
                                background: "rgba(255, 255, 255, 0.1)",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.min(utilization * 100, 100)}%`,
                                  height: "100%",
                                  background: isCapReached
                                    ? "linear-gradient(90deg, var(--text-error), rgba(255, 69, 58, 0.7))"
                                    : utilization > 0.9
                                      ? "linear-gradient(90deg, var(--text-warning), rgba(255, 159, 10, 0.7))"
                                      : "linear-gradient(90deg, var(--accent-cyan), rgba(0, 240, 255, 0.7))",
                                  borderRadius: "3px",
                                  transition: "width 0.3s ease",
                                }}
                              />
                            </div>
                            {isCapReached && (
                              <div style={{ marginTop: "8px", fontSize: "0.78rem", color: "var(--text-error)" }}>
                                <AlertTriangle size={12} style={{ display: "inline", marginRight: "4px" }} />
                                Deposits temporarily disabled
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          id={`vault-${tab}-review`}
                          className="btn btn-primary"
                          style={{ width: "100%", padding: "16px" }}
                          type="button"
                          onClick={goToReview}
                          disabled={isSubmitDisabled}
                        >
                          {t("vaultDashboard.reviewTransaction")}
                        </button>
                      </div>
                    )}

                    {dashboardUrl.state.step === "review" && (
                      <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col">
                        <div className="flex-1">
                          <h4 style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
                            <AlertCircle size={20} color="var(--accent-cyan)" />
                            {t("vaultDashboard.confirmTransaction")}
                          </h4>
                          
                          <div 
                            className="glass-panel" 
                            style={{ 
                              padding: "20px", 
                              background: "rgba(255, 255, 255, 0.02)",
                              border: "1px solid var(--border-glass)",
                              marginBottom: "20px"
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>{t("vaultDashboard.action")}</span>
                                <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{tab}</span>
                              </div>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>{t("vaultDashboard.amount")}</span>
                                <span style={{ fontWeight: 600 }}>{enteredAmount.toFixed(2)} USDC</span>
                              </div>
                              <div style={{ height: "1px", background: "var(--border-glass)" }} />
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>{t("vaultDashboard.protocolFeeLine")}</span>
                                <span style={{ fontWeight: 600 }}>{estimatedFee.toFixed(4)} USDC</span>
                              </div>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>{t("vaultDashboard.networkFee")}</span>
                                <span style={{ fontWeight: 600, textAlign: "right", display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                                  {isEstimating ? <Skeleton width="60px" height="1.1rem" /> : `${feeXlm.toFixed(4)} XLM`}
                                  {!isEstimating && (
                                    <Badge
                                      variant="outline"
                                      color={feeIsStale ? "warning" : "info"}
                                      size="compact"
                                      icon={<Clock3 size={10} />}
                                    >
                                      {feeIsStale
                                        ? t("vaultDashboard.feeQuoteStale").replace("{{age}}", feeAgeText).trim()
                                        : feeAgeText
                                          ? t("vaultDashboard.feeQuoteFresh").replace("{{age}}", feeAgeText)
                                          : t("vaultDashboard.feeQuoteFreshPlain")}
                                    </Badge>
                                  )}
                                </span>
                              </div>
                              <div style={{ height: "1px", background: "var(--border-glass)" }} />
                              <div className="flex justify-between items-center">
                                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{tab === "deposit" ? t("vaultDashboard.totalToVault") : t("vaultDashboard.totalToWallet")}</span>
                                <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent-cyan)" }}>
                                  {estimatedNetAmount.toFixed(4)} USDC
                                </span>
                              </div>
                            </div>
                          </div>

                          {tab === "withdraw" && isValidAmount && (
                            <details
                              className="glass-panel animate-in fade-in duration-300"
                              style={{
                                padding: "14px 16px",
                                background: "rgba(0,0,0,0.15)",
                                marginBottom: "16px",
                                border: "1px solid var(--border-glass)",
                              }}
                            >
                              <summary
                                style={{
                                  cursor: "pointer",
                                  fontSize: "0.85rem",
                                  fontWeight: 600,
                                  color: "var(--text-primary)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  userSelect: "none",
                                }}
                              >
                                <span style={{ fontSize: "1.2em" }}>ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â</span>
                                Advanced Settings
                                <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                                  Optional
                                </span>
                              </summary>
                              <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--border-glass)" }}>
                                <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "10px", fontWeight: 600 }}>
                                  {t("vaultDashboard.slippageTolerance")}
                                  <HelpIcon
                                    variant="popover"
                                    content="Maximum price difference you'll accept between transaction submission and execution"
                                    size="sm"
                                  />
                                </div>
                                <div className="flex items-center gap-sm" style={{ flexWrap: "wrap" }}>
                                  {presets.map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={() => { setSlippage(p); setCustomSlippage(""); }}
                                      style={{
                                        padding: "5px 12px",
                                        borderRadius: "6px",
                                        border: slippage === p && customSlippage === "" ? "1px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                                        background: slippage === p && customSlippage === "" ? "rgba(0,240,255,0.1)" : "transparent",
                                        color: slippage === p && customSlippage === "" ? "var(--accent-cyan)" : "var(--text-secondary)",
                                        fontSize: "0.82rem",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                      }}
                                    >
                                      {p}%
                                    </button>
                                  ))}
                                  <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    step="0.1"
                                    placeholder={t("vaultDashboard.customPlaceholder")}
                                    value={customSlippage}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setCustomSlippage(v);
                                      const n = parseFloat(v);
                                      if (isFinite(n) && n >= 0) setSlippage(n);
                                    }}
                                    style={{
                                      width: "80px",
                                      padding: "5px 8px",
                                      borderRadius: "6px",
                                      border: customSlippage !== "" ? "1px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                                      background: "transparent",
                                      color: "var(--text-primary)",
                                      fontSize: "0.82rem",
                                      outline: "none",
                                    }}
                                    aria-label={t("vaultDashboard.customSlippageAria")}
                                  />
                                  <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>%</span>
                                </div>
                                {isHighSlippage && (
                                  <div className="flex items-center gap-xs animate-in fade-in duration-200" style={{ marginTop: "8px" }}>
                                    <AlertTriangle size={13} color="var(--text-warning, #f59e0b)" />
                                    <span style={{ fontSize: "0.78rem", color: "var(--text-warning, #f59e0b)" }}>
                                      {t("vaultDashboard.highSlippageWarning")}
                                    </span>
                                  </div>
                                )}
                                <div className="flex justify-between" style={{ marginTop: "10px" }}>
                                  <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{t("vaultDashboard.minimumReceived")}</span>
                                  <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                                    {minReceived(estimatedNetAmount).toFixed(4)} USDC
                                  </span>
                                </div>
                              </div>
                            </details>
                          )}

                          {isHighFee && (                            <div
                              className="flex items-start gap-sm"
                              style={{
                                marginBottom: "20px",
                                padding: "12px",
                                borderRadius: "8px",
                                background: "rgba(255, 69, 58, 0.1)",
                                border: "1px solid rgba(255, 69, 58, 0.2)",
                              }}
                            >
                              <AlertTriangle size={16} color="var(--text-error)" style={{ marginTop: "2px" }} />
                              <div style={{ fontSize: "0.82rem", color: "var(--text-error)", lineHeight: "1.4" }}>
                                <strong style={{ display: "block", marginBottom: "2px" }}>{t("vaultDashboard.highNetworkFeeTitle")}</strong>
                                {t("vaultDashboard.highNetworkFeeDesc")}
                              </div>
                            </div>
                          )}

                          {tab === "deposit" && xlmBalance < feeXlm && (
                            <div
                              className="flex items-start gap-sm"
                              style={{
                                marginBottom: "20px",
                                padding: "12px",
                                borderRadius: "8px",
                                background: "rgba(255, 69, 58, 0.1)",
                                border: "1px solid rgba(255, 69, 58, 0.2)",
                              }}
                            >
                              <AlertTriangle size={16} color="var(--text-error)" style={{ marginTop: "2px" }} />
                              <div style={{ fontSize: "0.82rem", color: "var(--text-error)", lineHeight: "1.4" }}>
                                <strong style={{ display: "block", marginBottom: "2px" }}>{t("vaultDashboard.insufficientXlmTitle")}</strong>
                                {t("vaultDashboard.insufficientXlmDesc")}
                              </div>
                            </div>
                          )}

                          {tab === "deposit" && isValidAmount && needsApproval(enteredAmount) && (
                            <div
                              className="glass-panel"
                              style={{
                                padding: "14px 16px",
                                marginBottom: "20px",
                                border: approvalStatus === "confirmed"
                                  ? "1px solid rgba(0, 240, 255, 0.4)"
                                  : "1px solid rgba(255, 159, 10, 0.4)",
                                background: approvalStatus === "confirmed"
                                  ? "rgba(0, 240, 255, 0.05)"
                                  : "rgba(255, 159, 10, 0.05)",
                              }}
                            >
                              <div className="flex items-center gap-sm" style={{ marginBottom: "10px" }}>
                                <div
                                  className="flex items-center gap-xs"
                                  style={{
                                    fontSize: "0.78rem",
                                    fontWeight: 600,
                                    color: approvalStatus === "confirmed" ? "var(--accent-cyan)" : "rgba(255, 159, 10, 0.9)",
                                  }}
                                >
                                  <div style={{
                                    width: "20px", height: "20px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                    background: approvalStatus === "confirmed" ? "var(--accent-cyan)" : "rgba(255, 159, 10, 0.2)",
                                    border: approvalStatus === "confirmed" ? "none" : "1px solid rgba(255, 159, 10, 0.6)",
                                    fontSize: "0.7rem", color: approvalStatus === "confirmed" ? "#000" : "inherit"
                                  }}>
                                    {approvalStatus === "confirmed" ? <Check size={12} /> : "1"}
                                  </div>
                                  {t("vaultDashboard.approveUsdc")}
                                </div>
                                <div style={{ flex: 1, height: "1px", background: "var(--border-glass)" }} />
                                <div className="flex items-center gap-xs" style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                                  <div style={{ width: "20px", height: "20px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", fontSize: "0.7rem" }}>2</div>
                                  {t("vaultDashboard.depositStepLabel")}
                                </div>
                              </div>
                              {approvalStatus !== "confirmed" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  style={{ width: "100%", padding: "10px" }}
                                  status={approvalStatus === "pending" ? "pending" : "idle"}
                                  loadingLabel={t("vaultDashboard.approving")}
                                  disabled={approvalStatus === "pending"}
                                  onClick={async () => {
                                    try {
                                      await approve(enteredAmount);
                                      toast.success({ title: t("vaultDashboard.toast.usdcApproved") });
                                    } catch {
                                      toast.error({ title: t("vaultDashboard.toast.approvalFailed") });
                                    }
                                  }}
                                >
                                  {t("vaultDashboard.approveUsdc")}
                                </Button>
                              )}
                            </div>
                          )}

                          {activeConflict && (
                            <TransactionConflictResolver
                              conflict={activeConflict.conflict}
                              staleChanges={activeConflict.staleChanges}
                              onResolve={(resolution) => {
                                void handleConflictResolution(resolution);
                              }}
                              isResolving={isResolvingConflict}
                            />
                          )}
                        </div>

                        <div className="flex gap-md" style={{ marginTop: "auto" }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ flex: 1 }}
                            onClick={() => {
                              staleGuard.clearReviewSnapshot();
                              dashboardUrl.setStep("amount");
                            }}
                            disabled={isBusy}
                          >
                            {t("vaultDashboard.back")}
                          </button>
                          <Button
                            type="button"
                            id={`vault-${tab}-confirm`}
                            variant="primary"
                            style={{ flex: 2 }}
                            status={isBusy ? "pending" : "idle"}
                            loadingLabel={t("vaultDashboard.processing")}
                            onClick={() => void handleTransaction(tab)}
                            disabled={
                              isBusy || 
                              (tab === "deposit" && needsApproval(enteredAmount) && approvalStatus !== "confirmed") ||
                              (tab === "deposit" && xlmBalance < feeXlm)
                            }
                          >
                            {t("vaultDashboard.confirmAction").replace("{{tab}}", tab)}
                          </Button>
                        </div>
                      </div>
                    )}

                    {dashboardUrl.state.step === "result" && (
                      <div className="result-view flex-1 flex flex-col justify-center">
                        <TransactionTimeline
                          status={txTimelineStatus}
                          errorMessage={transactionResult?.message}
                          txHash={transactionResult?.txHash}
                        />

                        {(txTimelineStatus === "finalized" || txTimelineStatus === "failed") && (
                          <>
                            <div className={`result-icon-container ${transactionResult?.success ? "success" : "error"} animate-scale-in`}>
                              {transactionResult?.success ? <Check size={32} /> : <AlertTriangle size={32} />}
                            </div>
                            <h3 style={{ marginBottom: "12px" }}>
                              {transactionResult?.success ? t("vaultDashboard.transactionSuccessful") : t("vaultDashboard.transactionFailed")}
                            </h3>
                            <p style={{ color: "var(--text-secondary)", marginBottom: "8px", maxWidth: "300px" }}>
                              {transactionResult?.message}
                            </p>

                            {!transactionResult?.success && retryCount >= MAX_TRANSACTION_RETRY_ATTEMPTS && (
                              <p
                                role="alert"
                                style={{ color: "var(--text-warning, #f59e0b)", marginBottom: "24px", maxWidth: "300px", fontSize: "0.85rem" }}
                              >
                                {t("vaultDashboard.retryLimitReached")}
                              </p>
                            )}

                            {transactionResult?.success ? (
                              <button
                                type="button"
                                className="btn btn-primary"
                                style={{ width: "100%", padding: "16px" }}
                                onClick={resetWizard}
                              >
                                {t("vaultDashboard.done")}
                              </button>
                            ) : (
                              <div className="flex flex-col gap-sm" style={{ width: "100%", marginTop: "24px" }}>
                                {canRetryTransaction && (
                                  <Button
                                    type="button"
                                    variant="primary"
                                    style={{ width: "100%", padding: "16px" }}
                                    status={isBusy ? "pending" : "idle"}
                                    loadingLabel={t("vaultDashboard.processing")}
                                    onClick={() => void retryTransaction()}
                                  >
                                    {t("vaultDashboard.retryTransaction")}
                                  </Button>
                                )}
                                <button
                                  type="button"
                                  className={canRetryTransaction ? "btn btn-outline" : "btn btn-primary"}
                                  style={{ width: "100%", padding: "16px" }}
                                  onClick={resetWizard}
                                  disabled={isBusy}
                                >
                                  {t("vaultDashboard.startOver")}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
              </TabsContent>
              );
            })}
          </Tabs>
        </div>
        <div className="mobile-vault-actions">
          <button type="button" className="btn btn-primary" onClick={() => setMobileActionsOpen(true)}>
            <Menu size={16} />
            {t("vaultDashboard.quickActionsButton")}
          </button>
        </div>
      </div>
      {mobileActionsOpen && (
        <div className="mobile-bottom-sheet" role="dialog" aria-modal="true" aria-label={t("vaultDashboard.quickVaultActionsAria")}>
          <button
            type="button"
            className="mobile-bottom-sheet__backdrop"
            aria-label={t("vaultDashboard.closeQuickActionsAria")}
            onClick={() => setMobileActionsOpen(false)}
          />
          <div className="mobile-bottom-sheet__panel">
            <div className="mobile-bottom-sheet__handle" />
            <div className="flex justify-between items-center" style={{ marginBottom: "14px" }}>
              <strong>{t("vaultDashboard.quickActionsButton")}</strong>
              <button type="button" className="btn btn-outline" onClick={() => setMobileActionsOpen(false)} aria-label={t("vaultDashboard.closeQuickActionsAria")}>
                <X size={16} />
              </button>
            </div>
            <div className="mobile-bottom-sheet__actions">
              <button type="button" className="btn btn-primary" onClick={() => { dashboardUrl.setTab("deposit"); setMobileActionsOpen(false); }}>
                <ArrowDownUp size={16} />
                {t("vaultDashboard.tabs.deposit")}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => { dashboardUrl.setTab("withdraw"); setMobileActionsOpen(false); }}>
                <ArrowUpRight size={16} />
                {t("vaultDashboard.tabs.withdraw")}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => { navigate("/transactions"); setMobileActionsOpen(false); }}>
                <Clock3 size={16} />
                {t("vaultDashboard.activityLabel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VaultDashboard;
