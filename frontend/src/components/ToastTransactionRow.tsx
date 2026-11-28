import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, ExternalLink } from "./icons";
import { copyTextToClipboard } from "../lib/clipboard";
import { getStellarExplorerUrl, isValidTransactionHash } from "../lib/security";
import { truncateHash } from "../lib/transactionApi";
import { networkConfig } from "../config/network";
import { useTranslation } from "../i18n";

/**
 * The slice of the toast API this row needs. `ToastProvider` supplies it as a
 * prop rather than having the row call `useToast()`, because the row is rendered
 * *from inside* the toast tree — importing the context here would be a circular
 * import between `ToastContext` and this file.
 */
export interface ToastNotifier {
  success: (options: {
    title: string;
    description?: string;
    dedupeKey?: string;
  }) => string;
  error: (options: {
    title: string;
    description?: string;
    dedupeKey?: string;
  }) => string;
}

interface ToastTransactionRowProps {
  /** Full 64-character Stellar transaction hash. */
  txHash: string;
  notify: ToastNotifier;
}

type CopyStatus = "idle" | "success" | "error";

const FEEDBACK_TIMEOUT = 2000;

/**
 * Truncated transaction hash with a copy action and a network-correct Stellar
 * explorer link, rendered beneath a success toast's description.
 *
 * The visible text is truncated for layout while the clipboard always receives
 * the full hash. An unparseable hash renders nothing: there is no explorer page
 * for it and nothing trustworthy to copy.
 */
const ToastTransactionRow: React.FC<ToastTransactionRowProps> = ({
  txHash,
  notify,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!isValidTransactionHash(txHash)) {
    return null;
  }

  const explorerUrl = getStellarExplorerUrl(
    txHash,
    networkConfig.isTestnet ? "testnet" : "mainnet",
  );

  const showFeedback = (nextStatus: Exclude<CopyStatus, "idle">) => {
    setStatus(nextStatus);

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setStatus("idle");
      timeoutRef.current = null;
    }, FEEDBACK_TIMEOUT);
  };

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(txHash);
      showFeedback("success");
      notify.success({
        title: t("txToast.copySuccessTitle"),
        description: t("txToast.copySuccessDesc"),
        // Keeps repeated copies from queueing identical feedback toasts.
        dedupeKey: "tx-hash-copy",
      });
    } catch (error) {
      console.error("Transaction hash copy failed:", error);
      showFeedback("error");
      notify.error({
        title: t("txToast.copyErrorTitle"),
        description: t("txToast.copyErrorDesc"),
        dedupeKey: "tx-hash-copy",
      });
    }
  };

  return (
    <span className="yv-toast-tx">
      <span className="yv-toast-tx-hash" title={txHash} data-tx-hash={txHash}>
        {truncateHash(txHash)}
      </span>
      <button
        type="button"
        className="yv-toast-tx-copy"
        onClick={handleCopy}
        aria-label={t("txToast.copyAria")}
        data-status={status}
      >
        {status === "success" ? (
          <Check size={13} aria-hidden="true" />
        ) : status === "error" ? (
          <AlertCircle size={13} aria-hidden="true" />
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
        <span>
          {status === "success"
            ? t("txToast.copied")
            : status === "error"
              ? t("txToast.copyFailed")
              : t("txToast.copy")}
        </span>
      </button>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="yv-toast-tx-link"
        aria-label={t("txToast.explorerAria", { hash: txHash })}
      >
        <ExternalLink size={13} aria-hidden="true" />
        <span>{t("txToast.viewOnExplorer")}</span>
      </a>
    </span>
  );
};

export default ToastTransactionRow;
