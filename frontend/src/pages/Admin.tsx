import React from "react";
import { ShieldCheck } from "../components/icons";
import { useTranslation } from "../i18n";
import PageHeader from "../components/PageHeader";

interface AdminProps {
  walletAddress: string | null;
}

const Admin: React.FC<AdminProps> = ({ walletAddress }) => {
  const { t } = useTranslation();

  return (
    <div className="glass-panel" style={{ padding: "32px" }}>
      <PageHeader
        title={<span className="text-gradient">{t("admin.title")}</span>}
        description={t("admin.description")}
        breadcrumbs={[
          { label: t("analytics.homeLabel"), href: "/" },
          { label: t("admin.title") },
        ]}
        statusChips={[{ label: t("admin.badge"), variant: "success" }]}
      />

      <div
        className="glass-panel"
        style={{
          padding: "24px",
          display: "flex",
          alignItems: "flex-start",
          gap: "16px",
        }}
      >
        <ShieldCheck size={28} color="var(--accent-cyan)" aria-hidden="true" />
        <div>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            {t("admin.accessGranted")}
          </p>
          {walletAddress && (
            <p
              style={{
                color: "var(--text-tertiary)",
                fontSize: "0.85rem",
                marginTop: "8px",
                wordBreak: "break-all",
              }}
            >
              {walletAddress}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
