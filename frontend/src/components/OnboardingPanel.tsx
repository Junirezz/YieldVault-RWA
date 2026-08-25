import React from "react";
import { Wallet, Layers, TrendingUp } from "./icons";
import { useTranslation } from "../i18n";
import type { WalletConnectionStatus as WalletStatusValue } from "../lib/walletConnectionState";
import WalletConnectionStatus from "./WalletConnectionStatus";
import "./OnboardingPanel.css";

interface OnboardingStep {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  completed: boolean;
}

interface OnboardingPanelProps {
  /**
   * Pass either the legacy boolean (backward compatible) or the full
   * wallet connection status string for richer state rendering.
   */
  walletConnected: boolean;
  /**
   * Optional: full wallet connection status from the state machine.
   * When provided, the onboarding panel shows connecting/retrying/error
   * feedback directly in the first step rather than a binary connected/not.
   */
  walletStatus?: WalletStatusValue;
  /**
   * Optional: error title for the error state (resolved i18n string).
   */
  walletErrorTitle?: string | null;
  /**
   * Optional: error description for the error state (resolved i18n string).
   */
  walletErrorDescription?: string | null;
  /** Whether the wallet error is retryable. */
  walletErrorRetryable?: boolean;
  /** Retry attempt count (shown in retrying state). */
  walletRetryCount?: number;
  onConnectWallet: () => void;
  onReviewVault: () => void;
  onDeposit: () => void;
  /** Called when the user clicks Retry in the error state on step 1. */
  onRetryWallet?: () => void;
}

const OnboardingPanel: React.FC<OnboardingPanelProps> = ({
  walletConnected,
  walletStatus,
  walletErrorTitle,
  walletErrorDescription,
  walletErrorRetryable = true,
  walletRetryCount = 0,
  onConnectWallet,
  onReviewVault,
  onDeposit,
  onRetryWallet,
}) => {
  const { t } = useTranslation();

  // Derive connecting/error/retrying from walletStatus if provided.
  const isConnecting = walletStatus === "connecting";
  const isRetrying = walletStatus === "retrying";
  const isBusy = isConnecting || isRetrying;

  // Show the "connecting" label on the button when the wallet is in-flight.
  const step1ActionLabel = (() => {
    if (walletConnected) return t("onboarding.step1.connected");
    if (isRetrying) return t("wallet.retrying");
    if (isConnecting) return t("wallet.connecting");
    return t("onboarding.step1.action");
  })();

  const steps: OnboardingStep[] = [
    {
      step: 1,
      icon: <Wallet size={24} />,
      title: t("onboarding.step1.title"),
      description: t("onboarding.step1.description"),
      actionLabel: step1ActionLabel,
      onAction: onConnectWallet,
      completed: walletConnected,
    },
    {
      step: 2,
      icon: <Layers size={24} />,
      title: t("onboarding.step2.title"),
      description: t("onboarding.step2.description"),
      actionLabel: t("onboarding.step2.action"),
      onAction: onReviewVault,
      completed: false,
    },
    {
      step: 3,
      icon: <TrendingUp size={24} />,
      title: t("onboarding.step3.title"),
      description: t("onboarding.step3.description"),
      actionLabel: t("onboarding.step3.action"),
      onAction: onDeposit,
      completed: false,
    },
  ];

  const activeStep = walletConnected ? 1 : 0;

  return (
    <div className="onboarding-panel" role="region" aria-label={t("onboarding.ariaLabel")}>
      <div className="onboarding-panel-header">
        <h2 className="onboarding-panel-title">{t("onboarding.title")}</h2>
        <p className="onboarding-panel-subtitle">
          {t("onboarding.subtitle")}
        </p>
      </div>

      <ol className="onboarding-steps" aria-label={t("onboarding.stepsAria")}>
        {steps.map((s, idx) => {
          const isActive = idx === activeStep;
          const isPast = s.completed;
          const isFuture = idx > activeStep && !s.completed;

          return (
            <li
              key={s.step}
              className={[
                "onboarding-step",
                isPast ? "onboarding-step--completed" : "",
                isActive ? "onboarding-step--active" : "",
                isFuture ? "onboarding-step--future" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive ? "step" : undefined}
            >
              <div className="onboarding-step-indicator" aria-hidden="true">
                {isPast ? (
                  <span className="onboarding-step-check">✓</span>
                ) : (
                  <span className="onboarding-step-number">{s.step}</span>
                )}
              </div>

              <div className="onboarding-step-icon" aria-hidden="true">
                {s.icon}
              </div>

              <div className="onboarding-step-content">
                <h3 className="onboarding-step-title">{s.title}</h3>
                <p className="onboarding-step-description">{s.description}</p>

                {/* Inline status for step 1 only */}
                {idx === 0 && walletStatus && !walletConnected && (
                  <WalletConnectionStatus
                    status={walletStatus}
                    errorTitle={walletErrorTitle}
                    errorDescription={walletErrorDescription}
                    retryable={walletErrorRetryable}
                    retryCount={walletRetryCount}
                    onRetry={onRetryWallet ?? onConnectWallet}
                    className="onboarding-wallet-status"
                    style={{ marginTop: "8px" }}
                  />
                )}
              </div>

              <button
                type="button"
                className={`btn ${isActive ? "btn-primary" : "btn-outline"} onboarding-step-action`}
                onClick={s.onAction}
                disabled={isPast || isFuture || (idx === 0 && isBusy)}
                aria-label={s.actionLabel}
                aria-busy={idx === 0 && isBusy ? true : undefined}
              >
                {s.actionLabel}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default OnboardingPanel;
