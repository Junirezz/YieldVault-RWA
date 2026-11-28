import React, { useId } from "react";
import { useSelectedNetwork } from "../hooks/useSelectedNetwork";
import { useTranslation } from "../i18n";
import type { StellarNetwork } from "../config/selectedNetwork";

/**
 * User-facing network picker. The choice is persisted by `useSelectedNetwork`
 * and drives every derived RPC/Horizon/explorer URL in the app.
 */
const NetworkSelector: React.FC = () => {
  const { selectedNetwork, setSelectedNetwork } = useSelectedNetwork();
  const { t } = useTranslation();
  const label = t("networkSelector.label");
  const selectId = useId();

  return (
    <div className="network-selector" style={{ display: "flex", alignItems: "center" }}>
      <label htmlFor={selectId} className="sr-only">
        {label}
      </label>
      <select
        id={selectId}
        data-testid="network-selector"
        aria-label={label}
        value={selectedNetwork}
        onChange={(event) => setSelectedNetwork(event.target.value as StellarNetwork)}
        style={{
          padding: "6px 10px",
          borderRadius: "999px",
          fontSize: "0.75rem",
          fontWeight: "var(--font-semibold)",
          textTransform: "uppercase",
          color: "var(--text-primary)",
          background: "var(--bg-surface)",
          border:
            selectedNetwork === "mainnet"
              ? "1px solid rgba(34, 197, 94, 0.45)"
              : "1px solid rgba(56, 189, 248, 0.45)",
          cursor: "pointer",
        }}
      >
        <option value="testnet">{t("networkSelector.testnet")}</option>
        <option value="mainnet">{t("networkSelector.mainnet")}</option>
      </select>
    </div>
  );
};

export default NetworkSelector;
