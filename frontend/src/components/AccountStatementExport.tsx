import React, { useCallback, useMemo, useState } from "react";
import { Download } from "lucide-react";
import Modal from "./Modal";
import { AsyncActionButton } from "./ui/AsyncActionButton";
import { useTranslation } from "../i18n";
import {
  buildAccountStatement,
  buildAccountStatementFileName,
  serializeAccountStatement,
  type AccountStatementFormat,
} from "../lib/accountStatement";
import { downloadTextFile } from "../lib/exportDownload";
import type { PortfolioHolding } from "../lib/portfolioApi";
import { getTransactions, type Transaction } from "../lib/transactionApi";

export interface AccountStatementExportProps {
  walletAddress: string;
  holdings?: PortfolioHolding[];
  /** Optional preloaded transactions; when omitted the flow fetches from Horizon. */
  transactions?: Transaction[];
  /** Compact trigger for toolbars (defaults to secondary button). */
  triggerClassName?: string;
  triggerLabel?: string;
}

type ExportPhase = "idle" | "pending" | "success" | "error";

const AccountStatementExport: React.FC<AccountStatementExportProps> = ({
  walletAddress,
  holdings = [],
  transactions,
  triggerClassName = "btn btn-secondary",
  triggerLabel,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<AccountStatementFormat>("csv");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const labels = useMemo(
    () => ({
      idle: t("accountStatement.download"),
      pending: t("accountStatement.preparing"),
      success: t("accountStatement.downloaded"),
      error: t("accountStatement.failed"),
    }),
    [t],
  );

  const resetFeedback = useCallback(() => {
    setPhase("idle");
    setErrorMessage(null);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    resetFeedback();
  }, [resetFeedback]);

  const handleExport = useCallback(async () => {
    setPhase("pending");
    setErrorMessage(null);

    try {
      const txRows =
        transactions ??
        (await getTransactions({
          walletAddress,
          limit: 200,
          order: "desc",
          type: "all",
        }));

      const statement = buildAccountStatement({
        walletAddress,
        holdings,
        transactions: txRows,
        period: {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        },
      });

      const { content, mimeType, extension } = serializeAccountStatement(statement, format);
      const fileName = buildAccountStatementFileName(walletAddress, format).replace(
        /\.(csv|json)$/,
        `.${extension}`,
      );

      downloadTextFile({ content, fileName, mimeType });
      setPhase("success");
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : t("accountStatement.failed"));
    }
  }, [endDate, format, holdings, startDate, t, transactions, walletAddress]);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          resetFeedback();
          setOpen(true);
        }}
        style={{ alignSelf: "flex-end", height: "42px", display: "inline-flex", gap: "8px", alignItems: "center" }}
      >
        <Download size={16} aria-hidden />
        {triggerLabel ?? t("accountStatement.trigger")}
      </button>

      <Modal
        isOpen={open}
        onClose={handleClose}
        title={t("accountStatement.title")}
        description={t("accountStatement.description")}
        size="md"
        footer={
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", width: "100%" }}>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              {t("accountStatement.cancel")}
            </button>
            <AsyncActionButton
              labels={labels}
              isPending={phase === "pending"}
              isSuccess={phase === "success"}
              isError={phase === "error"}
              onClick={() => void handleExport()}
              variant="primary"
            />
          </div>
        }
      >
        <div className="flex flex-col gap-md" style={{ textAlign: "left" }}>
          <p className="text-body-sm" style={{ color: "var(--text-secondary)", margin: 0 }}>
            {t("accountStatement.walletLabel")}:{" "}
            <code style={{ wordBreak: "break-all" }}>{walletAddress}</code>
          </p>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend className="text-body-sm" style={{ marginBottom: "8px" }}>
              {t("accountStatement.formatLabel")}
            </legend>
            <div role="radiogroup" aria-label={t("accountStatement.formatLabel")} style={{ display: "flex", gap: "12px" }}>
              {(["csv", "json"] as const).map((option) => (
                <label key={option} style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="radio"
                    name="account-statement-format"
                    value={option}
                    checked={format === option}
                    onChange={() => setFormat(option)}
                  />
                  {option.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label className="input-group">
              <span className="text-body-sm">{t("accountStatement.startDate")}</span>
              <div className="input-wrapper">
                <input
                  className="input-field"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  aria-label={t("accountStatement.startDate")}
                />
              </div>
            </label>
            <label className="input-group">
              <span className="text-body-sm">{t("accountStatement.endDate")}</span>
              <div className="input-wrapper">
                <input
                  className="input-field"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  aria-label={t("accountStatement.endDate")}
                />
              </div>
            </label>
          </div>

          {errorMessage && (
            <p role="alert" style={{ color: "var(--text-error)", margin: 0 }}>
              {errorMessage}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
};

export default AccountStatementExport;
