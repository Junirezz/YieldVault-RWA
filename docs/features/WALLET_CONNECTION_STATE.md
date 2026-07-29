# Wallet connection state machine

## Overview

Freighter wallet connection in the YieldVault RWA frontend is modeled as an
**explicit state machine** rather than ad-hoc boolean flags. This keeps UI
feedback (connecting spinner, connected chip, typed errors + retry) aligned with
a single source of truth.

Implementation lives in:

- `frontend/src/lib/walletConnectionState.ts` — pure reducer, error classification, i18n key map
- `frontend/src/components/WalletConnect.tsx` — UI wired to the machine + Freighter APIs (reconnect prompt, session heartbeat, polling)

## Statuses

| Status | Meaning |
| --- | --- |
| `disconnected` | No session address; show **Connect Freighter** |
| `connecting` | User initiated connect / retry; button disabled + spinner |
| `connected` | Public key known; show truncated address + disconnect |
| `error` | Connection failed or Freighter dropped the session externally |

## Typed error codes

| Code | Retryable | Typical cause |
| --- | --- | --- |
| `NOT_INSTALLED` | No | Freighter extension missing |
| `PERMISSION_DENIED` | Yes | Site not allowed in Freighter |
| `USER_REJECTED` | Yes | User cancelled the prompt |
| `NO_ADDRESS` | Yes | Allowed but no public key returned |
| `DISCONNECTED_EXTERNALLY` | Yes | Polling detected Freighter session lost |
| `UNKNOWN` | Yes | Unclassified thrown error |

User-facing copy maps through `walletErrorI18nKeys()` onto `wallet.error.*` / `wallet.status.error`.

## Events

```text
CONNECT_REQUESTED / RETRY  → connecting
CONNECT_SUCCEEDED          → connected (+ address)
ADDRESS_SYNCED             → connected (+ address)   // parent / poll discovery
CONNECT_FAILED             → error (+ typed error)
DISCONNECT_REQUESTED       → disconnected
EXTERNAL_DISCONNECT        → error (DISCONNECTED_EXTERNALLY)
CLEAR_ERROR                → disconnected
PARENT_ADDRESS_CLEARED     → keep error; otherwise disconnected
```

Invalid transitions are no-ops (for example a second `CONNECT_REQUESTED` while
already `connecting`).

## UI contract

- `data-wallet-status` on the root control reflects the machine status.
- Error panels use `role="alert"` and `data-error-code="<CODE>"`.
- Retryable errors expose a **Try again** action that re-enters `connecting`.

## Testing

- Unit: `frontend/src/lib/walletConnectionState.test.ts` covers transitions and classification.
- Component: `frontend/src/components/WalletConnect.test.tsx` covers connect success, typed errors, and poll disconnect.
