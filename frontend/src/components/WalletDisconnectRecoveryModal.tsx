import React from "react";
import { Wallet, FileText, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { useTranslation } from "../i18n";
import type { VaultFormDraft } from "../lib/formDraftStorage";

interface WalletDisconnectRecoveryModalProps {
  draft: VaultFormDraft;
  onReconnect: () => void;
  onRestore: () => void;
  onDiscard: () => void;
}

const WalletDisconnectRecoveryModal: React.FC<WalletDisconnectRecoveryModalProps> = ({
  draft,
  onReconnect,
  onRestore,
  onDiscard,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen
      onClose={onDiscard}
      size="sm"
      closeOnBackdropClick={false}
      aria-labelledby="wallet-disconnect-recovery-title"
      aria-describedby="wallet-disconnect-recovery-desc"
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            background: "rgba(0, 240, 255, 0.1)",
            color: "var(--accent-cyan)",
            padding: "16px",
            borderRadius: "50%",
            display: "inline-flex",
            marginBottom: "16px",
          }}
        >
          <Wallet size={40} />
        </div>

        <h2
          id="wallet-disconnect-recovery-title"
          style={{ margin: "0 0 12px", fontSize: "1.5rem" }}
        >
          {t("walletRecovery.title")}
        </h2>
        <p
          id="wallet-disconnect-recovery-desc"
          style={{ color: "var(--text-secondary)", margin: "0 0 16px", lineHeight: 1.6 }}
        >
          {t("walletRecovery.description")}
        </p>

        <div
          className="glass-panel"
          style={{
            padding: "14px 16px",
            marginBottom: "20px",
            textAlign: "left",
            display: "flex",
            gap: "12px",
            alignItems: "flex-start",
          }}
        >
          <FileText size={18} color="var(--accent-cyan)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>
              {t("walletRecovery.draftLabel")}
            </div>
            <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              <span>{t(`walletRecovery.tab.${draft.tab}`)}</span>
              {" · "}
              <span>{draft.step}</span>
              {" · "}
              {draft.amount ? (
                <>
                  <span>{draft.amount}</span> USDC
                </>
              ) : (
                <span>{t("walletRecovery.noAmount")}</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onReconnect}
            style={{ width: "100%", padding: "14px" }}
          >
            {t("walletRecovery.reconnect")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRestore}
            style={{ width: "100%", padding: "14px" }}
          >
            {t("walletRecovery.restore")}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onDiscard}
            style={{
              width: "100%",
              padding: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <Trash2 size={16} />
            {t("walletRecovery.discard")}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default WalletDisconnectRecoveryModal;
