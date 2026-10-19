import React from "react";
import VaultDashboard from "../components/VaultDashboard";
import SecurityAuditOfferBanner from "../components/SecurityAuditOfferBanner";
import { usePageHeadingFocus } from "../hooks/usePageHeadingFocus";
import { useTranslation } from "../i18n";

interface HomeProps {
  walletAddress: string | null;
  usdcBalance: number;
  xlmBalance: number;
  /** True when the balance queries failed, so children can show an error state. */
  balancesError?: boolean;
}

const Home: React.FC<HomeProps> = ({ walletAddress, usdcBalance, xlmBalance, balancesError = false }) => {
  const headingRef = usePageHeadingFocus<HTMLHeadingElement>();
  const { t } = useTranslation();

  return (
    <>
      <header style={{ textAlign: "center", marginBottom: "48px" }}>
        <span className="tag cyan" style={{ marginBottom: "16px" }}>
          {t("hero.tag")}
        </span>
        <h1 ref={headingRef} tabIndex={-1} data-page-heading="true" style={{ marginBottom: "16px" }}>
          {t("hero.heading")} <br />
          <span className="text-gradient">{t("hero.headingAccent")}</span>
        </h1>
        <p className="text-body-lg" style={{ maxWidth: "600px", margin: "0 auto" }}>
          {t("hero.description")}
        </p>
      </header>

      <SecurityAuditOfferBanner />

      <VaultDashboard
        walletAddress={walletAddress}
        usdcBalance={usdcBalance}
        xlmBalance={xlmBalance}
        balancesError={balancesError}
      />
    </>
  );
};

export default Home;
