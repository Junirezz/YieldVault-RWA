import { useTranslation, type LocaleCode } from "../i18n";

const LOCALES: { code: LocaleCode; flag: string }[] = [
  { code: "en", flag: "🇺🇸" },
  { code: "es", flag: "🇪🇸" },
];

interface LanguageSwitcherProps {
  compact?: boolean;
}

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { t, locale, setLocale } = useTranslation();

  if (compact) {
    return (
      <div className="language-switcher language-switcher--compact" role="group" aria-label={t("langSwitch.label")}>
        {LOCALES.map(({ code, flag }) => {
          const isActive = locale === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={isActive}
              aria-label={t(`langSwitch.${code}`)}
              className="language-switcher__btn"
              data-active={isActive ? "true" : "false"}
            >
              <span aria-hidden="true">{flag}</span>
              <span className="language-switcher__code">{code.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="language-switcher" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span
        style={{
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {t("langSwitch.label")}
      </span>
      <div style={{ display: "flex", gap: "4px" }}>
        {LOCALES.map(({ code, flag }) => {
          const isActive = locale === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={isActive}
              aria-label={t(`langSwitch.${code}`)}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: isActive
                  ? "1.5px solid var(--accent-cyan)"
                  : "1.5px solid var(--border-glass)",
                background: isActive
                  ? "linear-gradient(135deg, rgba(0,240,255,0.12), rgba(112,0,255,0.08))"
                  : "rgba(255,255,255,0.03)",
                color: isActive ? "var(--accent-cyan)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: isActive ? 600 : 400,
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span aria-hidden="true">{flag}</span>
              {t(`langSwitch.${code}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
