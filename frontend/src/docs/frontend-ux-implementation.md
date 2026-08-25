# Frontend Wallet, Theme, Form, and API Error Surface

This note maps the implemented user-facing frontend surface to the modules that
own each behavior.

## Wallet connection persistence

- `src/lib/walletConnectionState.ts` owns the typed connection reducer and wallet error classification.
- `src/lib/walletSession.ts` persists the last provider, reconnect prompt flags, and the validated connected wallet address.
- `src/App.tsx` restores the persisted address on load, updates it after successful connection, and clears it on disconnect.

## Theme support

- `src/context/PreferencesContext.tsx` resolves `dark`, `light`, and `system` preferences, applies `data-theme`, and persists the preference.
- `src/components/ThemeToggle.tsx` exposes the header toggle.
- `src/index.css` defines the dark default and `[data-theme='light']` CSS variables.

## Real-time form validation

- `src/forms/useForm.ts` validates on blur, revalidates touched fields while typing, and validates all fields on submit.
- `src/forms/components/FormField.tsx`, `FormSelect.tsx`, and `FormTextarea.tsx` render inline errors with `aria-invalid` and `role="alert"`.
- Deposit and withdrawal rules live in `src/forms/schemas/depositFormSchema.ts` and `withdrawFormSchema.ts`.

## API error handling

- `src/lib/api/error.ts` normalizes network, timeout, auth, HTTP, and invalid-response failures into `ApiError`.
- `src/lib/api/client.ts` applies retry/correlation behavior and throws normalized `ApiError` instances.
- `src/components/ApiStatusBanner.tsx` displays user-friendly API messages instead of raw backend objects.
