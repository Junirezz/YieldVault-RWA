import type { ApiError, ValidationError } from "../lib/api";
import type { FC } from "react";
import { useTranslation } from "../i18n";
import EmptyState from "./ui/EmptyState";

interface ApiStatusBannerProps {
  error: ApiError | ValidationError;
}

const ApiStatusBanner: FC<ApiStatusBannerProps> = ({ error }) => {
  const { t } = useTranslation();
  const description =
    error.userMessage === "Failed to load vault data"
      ? error.userMessage
      : `Failed to load vault data. ${error.userMessage}`;

  return (
    <EmptyState
      kind="error"
      title={t("apiBanner.title")}
      description={description}
      className="empty-state-compact api-status-banner"
    />
  );
};

export default ApiStatusBanner;
