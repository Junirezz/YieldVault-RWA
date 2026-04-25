import Skeleton from "./Skeleton";
import { useTranslation } from "../i18n";

export default function RouteLoadingFallback() {
  const { t } = useTranslation();

  return (
    <section
      aria-live="polite"
      aria-busy="true"
      style={{ display: "grid", gap: "20px", padding: "8px 0" }}
    >
      <header style={{ display: "grid", gap: "12px" }}>
        <Skeleton height={32} width="260px" borderRadius={8} />
        <Skeleton height={16} width="380px" borderRadius={8} />
      </header>

      <Skeleton height={120} borderRadius={12} />
      <Skeleton height={260} borderRadius={12} />

      <p style={{ color: "var(--text-muted)", margin: 0 }}>{t("app.loading.subtitle")}</p>
    </section>
  );
}
