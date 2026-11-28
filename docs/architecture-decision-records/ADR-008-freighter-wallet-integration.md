# ADR-008: Freighter as the Wallet Integration for Stellar Transactions

**Date:** 2026-11-22
**Status:** Accepted
**Author:** YieldVault Contributors
**Reviewers:** N/A

---

## Context

Every sensitive vault operation (deposit, withdrawal, admin configuration
change) must be signed by the user's Stellar keypair before the backend or
contract will act on it. YieldVault needed a browser-based signing flow that
never exposes the user's private key to the application, and that works with
Soroban's XDR transaction format.

## Decision

Use Freighter (`@stellar/freighter-api`) as the frontend's wallet connector
for all signing operations. The frontend builds an unsigned transaction,
hands it to Freighter for signing, and submits the signed XDR to the
backend/network. See `README.md` ("Wallet Connection: Freighter") and the
sign-with-Freighter step in `docs/ARCHITECTURE_MAP.md`.

## Rationale

- Freighter is the Stellar Development Foundation's own browser extension
  wallet and has first-class support for Soroban smart contract
  invocations and XDR signing, which this project relies on for every vault
  transaction.
- `@stellar/freighter-api` is a maintained, officially supported client
  library, avoiding a custom key-management implementation in the frontend.
- Keeping all signing in the Freighter extension means the private key
  never enters frontend application memory or is transmitted to the
  backend.

## Alternatives Considered

### Alternative 1: Custom in-app key management (local keystore)
- **Pros:** No dependency on a browser extension; works without Freighter
  installed.
- **Cons:** Requires the application to handle private key storage and
  signing directly, a materially larger security surface for a
  non-custodial protocol holding user funds.

### Alternative 2: WalletConnect-style multi-wallet abstraction
- **Pros:** Supports multiple Stellar wallets through one interface.
- **Cons:** Added integration complexity and an extra dependency for
  marginal benefit at the project's current stage, where Freighter is the
  dominant Stellar wallet; can be revisited if multi-wallet support becomes
  a requirement.

## Consequences

### Positive
- Users' private keys never leave the Freighter extension.
- Direct support for Soroban contract invocation signing without a custom
  XDR-signing implementation.

### Negative
- Users without the Freighter extension installed cannot use the app until
  they install it; there is no fallback wallet today.

## Related Links
- `frontend/package.json` (`@stellar/freighter-api`)
- `docs/ARCHITECTURE_MAP.md`
- Issue #1660
