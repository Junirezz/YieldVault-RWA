# i18n scaffolding (frontend)

## Overview

The YieldVault-RWA frontend uses a **small in-repo i18n layer** (no `i18next` dependency). Message catalogs live under `frontend/src/i18n/locales/` as TypeScript modules. The API is:

- `t('dot.separated.key')` — resolve a string for the active locale
- `useTranslation()` — React hook that returns `{ t, locale, setLocale }` and re-renders when the locale changes
- `setLocale('en' | 'es')` — switch the active locale (wire a language picker to this when ready)

English is the **primary** catalog and the **fallback** for any key missing in another locale.

## Directory structure

```text
frontend/src/i18n/
  index.ts              # t(), getLocale(), setLocale(), subscribeLocale(), useTranslation()
  locales/
    en.ts               # Primary (English) messages
    es.ts               # Secondary (Spanish) messages
```

Keys are **dot-separated paths** into nested objects (for example `nav.vaults`, `app.loading.title`).

## Adding a new language

1. Add a file `frontend/src/i18n/locales/<code>.ts` (for example `fr.ts`) exporting an object with the **same nested shape** as `en.ts`.
2. In `frontend/src/i18n/index.ts`:
   - Extend the `LocaleCode` union with your code (e.g. `"fr"`).
   - Add an entry to the `catalogs` map: `fr: frCatalog`.

Until a key exists in the new locale, `t()` will use the English string for that key if present, then fall back to returning the key string (see below).

## Missing key behavior (user-safe)

If a key is not found in the active locale **or** in English, `t()` returns the **key string** as-is.

- The UI never shows `undefined` or throws from a missing translation.
- Developers see the raw key (e.g. `nav.newItem`) in the interface, which makes omissions obvious in development and QA.

## Build vs. E2E typecheck

The frontend root `tsc -b` references the application and Node/Vite config projects only, so `npm run build` does not require `@playwright/test`. To typecheck Playwright specs, install Playwright locally and run `tsc -p tsconfig.e2e.json` from `frontend/`.

Vitest runs tests under `src/` only (see `vite.config.ts`); browser E2E remains `npm run test:e2e`.

## Limitations and next steps

- **No pluralization or ICU formatting** — messages are plain strings; complex plural/rules would need a richer library or custom helpers.
- **No date/number localization** — use `Intl.DateTimeFormat` / `Intl.NumberFormat` (or a dedicated library) when formatting for display.
- **Interpolation** — `t()` does not substitute variables; compose in JSX or extend the helper if you need `{name}`-style templates.
- **Locale detection** — not implemented; `setLocale` is explicit. Future work could read `navigator.language` or a user profile once a UX exists.
