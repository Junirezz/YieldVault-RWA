import React from "react";
import { Check, AlertCircle, Loader2 } from "./icons";
import { useTranslation } from "../i18n";

export type TxTimelineStatus = "preparing" | "signing" | "submitting" | "pending" | "confirming" | "finalized" | "failed";

export interface TransactionTimelineProps {
  status: TxTimelineStatus;
  txHash?: string;
  /** Elapsed seconds since the transaction was submitted */
  elapsedSeconds?: number;
  /** Error message shown when status is "failed" */
  errorMessage?: string;
  /** Callback for when the user clicks Retry on a failed step */
  onRetry?: () => void;
}

interface Step {
  key: TxTimelineStatus;
  labelKey: string;
  descKey: string;
}

const STEPS: Step[] = [
  { key: "preparing",  labelKey: "txTimeline.steps.preparing.label",  descKey: "txTimeline.steps.preparing.desc" },
  { key: "signing",    labelKey: "txTimeline.steps.signing.label",    descKey: "txTimeline.steps.signing.desc" },
  { key: "submitting", labelKey: "txTimeline.steps.submitting.label", descKey: "txTimeline.steps.submitting.desc" },
  { key: "confirming", labelKey: "txTimeline.steps.confirming.label", descKey: "txTimeline.steps.confirming.desc" },
];

const STATUS_ORDER: Record<TxTimelineStatus, number> = {
  preparing: 0,
  signing: 1,
  submitting: 2,
  pending: 3,
  confirming: 4,
  finalized: 5,
  failed: 5,
};

type StepState = "completed" | "active" | "failed" | "upcoming";

function getStepState(
  stepKey: TxTimelineStatus,
  currentStatus: TxTimelineStatus,
  stepIndex: number,
): StepState {
  if (currentStatus === "failed" && stepIndex === STATUS_ORDER.confirming) return "failed";
  const currentOrder = STATUS_ORDER[currentStatus];
  const stepOrder = STATUS_ORDER[stepKey];
  if (stepOrder < currentOrder) return "completed";
  if (stepOrder === currentOrder) return "active";
  return "upcoming";
}

const STEP_COLORS: Record<StepState, { dot: string; line: string; text: string }> = {
  completed: { dot: "var(--accent-green)",   line: "rgba(34, 197, 94, 0.4)",  text: "var(--accent-green)" },
  active:    { dot: "var(--accent-cyan)",    line: "rgba(0, 240, 255, 0.2)",  text: "var(--accent-cyan)" },
  failed:    { dot: "var(--text-error)",     line: "rgba(255, 107, 107, 0.3)", text: "var(--text-error)" },
  upcoming:  { dot: "var(--text-tertiary)",  line: "var(--border-glass)",     text: "var(--text-tertiary)" },
};

function StepIcon({ state }: { state: StepState }) {
  if (state === "completed") return <Check size={14} />;
  if (state === "failed")    return <AlertCircle size={14} />;
  if (state === "active")    return <Loader2 size={14} className="spin" style={{ animation: "spin 0.9s linear infinite" }} />;
  return null;
}

const TransactionTimeline: React.FC<TransactionTimelineProps> = ({
  status,
  txHash,
  elapsedSeconds,
  errorMessage,
  onRetry,
}) => {
  const { t } = useTranslation();

  const steps = status === "failed"
    ? STEPS // show all steps, the failed one will be marked failed based on order
    : STEPS;

  return (
    <div
      role="status"
      aria-label={t("txTimeline.ariaLabel")}
      aria-live="polite"
      style={{ padding: "4px 0" }}
    >
      {steps.map((step, index) => {
        const stepState = getStepState(step.key, status, index);
        const colors = STEP_COLORS[stepState];
        const isLast = index === steps.length - 1;

        return (
          <div key={step.key} style={{ display: "flex", gap: "14px" }}>
            {/* Connector column */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: "var(--bg-surface)",
                  border: `2px solid ${colors.dot}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: colors.dot,
                  flexShrink: 0,
                  transition: "border-color 0.3s, color 0.3s",
                }}
              >
                <StepIcon state={stepState} />
              </div>
              {!isLast && (
                <div
                  style={{
                    width: "2px",
                    flex: 1,
                    minHeight: "20px",
                    background: colors.line,
                    transition: "background 0.3s",
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingBottom: isLast ? 0 : "20px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "2px" }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: "var(--text-sm)",
                    color: stepState === "upcoming" ? "var(--text-tertiary)" : "var(--text-primary)",
                    transition: "color 0.3s",
                  }}
                >
                  {t(step.labelKey)}
                </span>
                {stepState === "active" && elapsedSeconds !== undefined && (
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                    {elapsedSeconds}s
                  </span>
                )}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  lineHeight: "var(--leading-relaxed)",
                }}
              >
                {stepState === "failed" && errorMessage
                  ? errorMessage
                  : t(step.descKey)}
              </p>
              {stepState === "failed" && onRetry && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: "8px", padding: "4px 12px", fontSize: "0.8rem" }}
                  onClick={onRetry}
                >
                  {t("txTimeline.retryButton")}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Final state row for finalized/failed */}
      {(status === "finalized" || status === "failed") && (
        <div style={{ display: "flex", gap: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: status === "finalized" ? "rgba(34, 197, 94, 0.15)" : "var(--bg-error)",
                border: `2px solid ${status === "finalized" ? "var(--accent-green)" : "var(--text-error)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: status === "finalized" ? "var(--accent-green)" : "var(--text-error)",
              }}
            >
              {status === "finalized" ? <Check size={14} /> : <AlertCircle size={14} />}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: "var(--text-sm)",
                color: status === "finalized" ? "var(--accent-green)" : "var(--text-error)",
              }}
            >
              {t(status === "finalized" ? "txTimeline.steps.finalized.label" : "txTimeline.steps.failed.label")}
            </span>
            <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
              {status === "failed" && errorMessage
                ? errorMessage
                : t(status === "finalized" ? "txTimeline.steps.finalized.desc" : "txTimeline.steps.failed.desc")}
            </p>
            {status === "finalized" && txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: "6px",
                  fontSize: "var(--text-xs)",
                  color: "var(--accent-cyan)",
                  textDecoration: "none",
                }}
              >
                {t("txTimeline.viewOnExplorer")} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionTimeline;
