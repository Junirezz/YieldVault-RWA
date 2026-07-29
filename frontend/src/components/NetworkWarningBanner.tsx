import React, { useState } from "react";
import { AlertTriangle } from "./icons";
import { useWalletNetwork } from "../hooks/useWalletNetwork";
import { useTranslation } from "../i18n";
import NetworkMismatchGuideModal from "./NetworkMismatchGuideModal";

interface NetworkWarningBannerProps {
  walletAddress: string | null;
}

const NetworkWarningBanner: React.FC<NetworkWarningBannerProps> = ({ walletAddress }) => {
  const { isMismatch, walletNetwork, expectedNetwork, isChecking, checkNow } =
    useWalletNetwork(walletAddress);
  const { t } = useTranslation();
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  if (!isMismatch) return null;

  return (
    <>
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: "fixed",
          top: "72px",
          left: 0,
          right: 0,
          zIndex: 200,
          background: "rgba(220, 38, 38, 0.95)",
          borderBottom: "1px solid rgba(255, 100, 100, 0.5)",
          backdropFilter: "blur(8px)",
          color: "#fff",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: "10px",
          fontSize: "0.875rem",
          lineHeight: "1.5",
        }}
      >
        <AlertTriangle size={18} style={{ flexShrink: 0 }} />
        <span>
          <strong>{t("networkWarning.wrongNetwork")}</strong>{" "}
          {t("networkWarning.walletOn")}{" "}
          <strong>{walletNetwork}</strong>,{" "}
          {t("networkWarning.appRequires")}{" "}
          <strong>{expectedNetwork}</strong>.{" "}
          {t("networkWarning.switchInstructions").replace("{{network}}", expectedNetwork ?? "")}
        </span>
        <button
          type="button"
          onClick={() => setIsGuideOpen(true)}
          style={{
            background: "rgba(255, 255, 255, 0.15)",
            border: "1px solid rgba(255, 255, 255, 0.4)",
            borderRadius: "6px",
            color: "#fff",
            padding: "4px 10px",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {t("networkWarning.fixNow")}
        </button>
      </div>
      <NetworkMismatchGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        isMismatch={isMismatch}
        isChecking={isChecking}
        walletNetwork={walletNetwork}
        expectedNetwork={expectedNetwork}
        onCheckNow={checkNow}
      />
    </>
  );
};

export default NetworkWarningBanner;
