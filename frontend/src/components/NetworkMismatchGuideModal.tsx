import React, { useEffect, useRef, useState } from "react";
import { CheckCircle } from "lucide-react";
import { AlertTriangle, RefreshCw } from "./icons";
import { Modal } from "./Modal";
import { useTranslation } from "../i18n";

interface NetworkMismatchGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  isMismatch: boolean;
  isChecking: boolean;
  walletNetwork: string | null;
  expectedNetwork: string;
  onCheckNow: () => void;
}

/**
 * Step-by-step guided fix flow for a wallet/app network mismatch. Rendered
 * from a "Show me how to fix this" action on the persistent warning banner.
 * Closes itself once a recheck confirms the wallet is on the expected
 * network, so the user gets a clear "you're all set" moment instead of just
 * having the banner silently disappear.
 */
const NetworkMismatchGuideModal: React.FC<NetworkMismatchGuideModalProps> = ({
  isOpen,
  onClose,
  isMismatch,
  isChecking,
  walletNetwork,
  expectedNetwork,
  onCheckNow,
}) => {
  const { t } = useTranslation();
  const [hasChecked, setHasChecked] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setHasChecked(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && hasChecked && !isChecking && !isMismatch) {
      onClose();
    }
  }, [isOpen, hasChecked, isChecking, isMismatch, onClose]);

  if (!isOpen) return null;

  const handleCheckAgain = () => {
    setHasChecked(true);
    onCheckNow();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      aria-labelledby="network-guide-title"
      aria-describedby="network-guide-desc"
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            background: "rgba(220, 38, 38, 0.1)",
            color: "rgb(220, 38, 38)",
            padding: "16px",
            borderRadius: "50%",
            display: "inline-flex",
            marginBottom: "16px",
          }}
        >
          <AlertTriangle size={32} />
        </div>

        <h2 id="network-guide-title" style={{ margin: "0 0 12px", fontSize: "1.35rem" }}>
          {t("networkWarning.guide.title")}
        </h2>
        <p
          id="network-guide-desc"
          style={{ color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.6 }}
        >
          {t("networkWarning.guide.description")
            .replace("{{wallet}}", walletNetwork ?? expectedNetwork)
            .replace("{{expected}}", expectedNetwork)}
        </p>

        <ol
          style={{
            textAlign: "left",
            margin: "0 0 20px",
            padding: "0 0 0 20px",
            color: "var(--text-primary)",
            lineHeight: 1.9,
          }}
        >
          <li>{t("networkWarning.guide.step1")}</li>
          <li>{t("networkWarning.guide.step2")}</li>
          <li>{t("networkWarning.guide.step3").replace("{{expected}}", expectedNetwork)}</li>
        </ol>

        {hasChecked && !isChecking && isMismatch && (
          <p
            role="status"
            style={{
              color: "rgb(220, 38, 38)",
              fontSize: "0.875rem",
              margin: "0 0 16px",
            }}
          >
            {t("networkWarning.guide.stillMismatched").replace(
              "{{wallet}}",
              walletNetwork ?? expectedNetwork,
            )}
          </p>
        )}

        {hasChecked && !isChecking && !isMismatch && (
          <p
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              color: "rgb(34, 197, 94)",
              fontSize: "0.875rem",
              margin: "0 0 16px",
            }}
          >
            <CheckCircle size={16} />
            {t("networkWarning.guide.resolved").replace("{{expected}}", expectedNetwork)}
          </p>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCheckAgain}
          disabled={isChecking}
          style={{
            width: "100%",
            padding: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          <RefreshCw size={16} className={isChecking ? "spin" : undefined} />
          {isChecking ? t("networkWarning.guide.checking") : t("networkWarning.guide.checkAgain")}
        </button>
      </div>
    </Modal>
  );
};

export default NetworkMismatchGuideModal;
