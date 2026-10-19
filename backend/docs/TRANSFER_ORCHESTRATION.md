# Idempotent Retry-Safe Transfer Orchestration (Issue #1043)

A vault transfer moves money. `submitVaultOperation` builds a **fresh**
transaction — fresh sequence number, fresh signature — and pushes it to the
network. So retrying that call is not a repeat of the first attempt; it is a
second transaction.

That makes "just retry it" the wrong default. `src/transferOrchestrator.ts` is
the service that decides, for every failure, whether a retry is safe.

## What the previous implementation covered, and what it didn't

The original service wrapped the RPC in `IdempotencyStore.execute`. That gives
the happy path: same key twice → one transaction, second caller replays the
stored response. Everything else was open:

| Gap | Consequence |
| --- | --- |
| Client key used verbatim as the store key | Wallet A's key `"1"` occupied wallet B's slot — B replayed A's transaction hash or got a spurious 409 |
| No request validation | A negative or `NaN` amount reached the signing path |
| Every failure retried blind | A failure *after* the envelope hit the network was retried, which can transfer twice |
| Terminal rejections not stored | A guaranteed-to-fail 422 re-ran the full build/simulate path on every retry |
| No fail-fast, no timeout | A dead RPC absorbed the whole retry budget per request; a hung call held the key's in-flight slot for the life of the process |
| No metrics, no alert | None of the above was visible |

## The retry-safety contract

> For a given **(wallet, idempotency key)** pair, at most one transaction is ever
> submitted. Every later call either replays the stored outcome or fails loudly.
> It never silently submits a second transaction.

## Failure classification

Everything rests on one question: *did the signed envelope reach the network?*

| Class | Meaning | Stored under the key? | Caller may retry? |
| --- | --- | --- | --- |
| `retryable` | Proven to have failed **before** submission. Nothing moved. | No — so the retry re-executes | Yes, same key |
| `terminal` | The request itself is invalid; retrying cannot help. | Yes, as a `rejected` record | Retrying replays the same rejection |
| `indeterminate` | The envelope may or may not have landed. | Yes, as an `in_doubt` record | **No** — blocked until reconciled |

The mapping comes from reading `submitVaultOperation`'s own error codes:

| Soroban code | Class | Why |
| --- | --- | --- |
| `INVALID_ADDRESS`, `INVALID_AMOUNT` | `terminal` | Argument validation, raised before anything is built |
| `SIMULATION_ERROR` | `retryable` | Raised on the simulate path; no envelope was sent |
| `RESTORE_REQUIRED` | `retryable` | Simulation asked for a ledger restore; nothing was sent |
| `RPC_ERROR` | `retryable` | RPC returned `status === 'ERROR'` — an explicit rejection, so no transaction exists |
| `SOROBAN_CIRCUIT_OPEN` | `retryable` | Fail-fast; the RPC was never called |
| `SUBMISSION_FAILED` | `indeterminate` | Submit returned an unexpected status — the envelope was already handed over |
| `INTERNAL_ERROR` | `indeterminate` | Catch-all wrapper; may be a socket error mid-submit |
| `TRANSFER_TIMEOUT` | `indeterminate` | The call never settled; silence is not proof |

**Unknown failures default to `indeterminate`.** This is deliberately the
opposite of `classifyWithdrawalFailure`, which defaults to `retryable`. That
coordinator retries *idempotent* steps; a retry here mints a new transaction.
When we cannot prove nothing moved, we refuse to move again.

## Wallet-scoped keys

The client's key never reaches the store directly:

```
transfer:<sha256(normalizedWallet)[0..16]>:<clientKey>
```

Two wallets can therefore both use `"checkout-1"` without colliding. The wallet
is hashed rather than embedded so the key stays bounded and no address leaks into
a Redis `KEYS`/`SCAN` listing. Normalisation is case-insensitive, so
`gabc…`/`GABC…` are one wallet.

Keys must be 8–255 characters (`TRANSFER_ORCHESTRATION_MAX_KEY_LENGTH`) from
`[A-Za-z0-9._:~-]`. The charset rules out whitespace and newlines, which are
unsafe in a Redis key segment; the minimum length rules out trivially guessable
keys that invite cross-request collisions within one wallet.

## Request canonicalisation

Before fingerprinting, the request is canonicalised: wallet upper-cased, asset
upper-cased, amount trimmed. Two spellings of the same transfer therefore share
one fingerprint and replay correctly instead of raising a false conflict.

Amounts must match `^\d+(\.\d+)?$` and be `> 0`. Strings are used so JSON cannot
round the value, and the pattern rejects `NaN`, `Infinity`, `1e3` and signed
values — all of which `Number()` would otherwise coerce further down the stack.

## The in-doubt window

When a failure is `indeterminate`, the orchestrator:

1. Stores an `in_doubt` record under the key. **This is the mechanism that stops
   a retry** — the next call hits the stored record instead of the RPC.
2. Registers the transfer in the in-doubt registry with everything an operator
   needs to reconcile it: wallet, operation, amount, asset, failing code, the
   original idempotency key, and the trace ID.
3. Logs at `error` with `alert: "transfer-in-doubt"` and raises the in-doubt
   gauge.
4. Throws `TransferInDoubtError` (409) — to the caller that opened the window and
   to every caller after it.

### Reconciling

An operator checks the chain, then calls:

```ts
// The transfer did land — replays of the original key now return this hash.
await resolveInDoubtTransfer(storeKey, { transactionHash: 'abc…' });

// Nothing landed — release the key so the client may retry from scratch.
await resolveInDoubtTransfer(storeKey, { discard: true });
```

`listInDoubtTransfers()` and `getInDoubtTransfer(storeKey)` expose the queue.
Neither leaks the internal fingerprint.

The admin API exposes the same controls:

```http
GET /admin/transfers/in-doubt
POST /admin/transfers/{storeKey}/resolve
```

Both routes require an admin API key. The resolve body must be exactly one of
`{"transactionHash":"<on-chain-hash>"}` or `{"discard":true}`. Use the hash
only after confirming the transfer landed; discard only after checking that no
matching transaction landed, because it releases the idempotency key for a new
submission. Each resolution attempt is recorded as the
`transfers.in_doubt.confirm` or `transfers.in_doubt.discard` admin audit action.
Unknown or already-resolved keys return `404`.

## Errors

Every failure is a `TransferOrchestrationError` subclass carrying `code`,
`statusCode` and `classification`, so an HTTP layer can map them uniformly.

| Error | Status | When |
| --- | --- | --- |
| `TransferValidationError` | 400 / 422 | Malformed key or request; never reaches the network |
| `TransferConflictError` | 409 | Key reused with a different body |
| `TransferInDoubtError` | 409 | Outcome unknown; needs reconciliation |
| `TransferUnavailableError` | 503 | Dependency down, nothing submitted (`retryAfterMs` set when the circuit is open) |
| `TransferOrchestrationError` | 422 (stored) | A replayed terminal rejection |

## Metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `transfer_orchestration_total` | counter | `operation`, `outcome` |
| `transfer_orchestration_replay_total` | counter | `operation`, `replay_of` |
| `transfer_orchestration_failure_total` | counter | `operation`, `classification`, `code` |
| `transfer_orchestration_duration_ms` | histogram | `operation`, `outcome` |
| `transfer_orchestration_in_doubt` | gauge | — |

`transfer_orchestration_in_doubt > 0` is the page-worthy signal: money may have
moved without a ledger record. Pair it with the `transfer-in-doubt` log alert.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRANSFER_ORCHESTRATION_TIMEOUT_MS` | `45000` | Caps a single submission so a hung RPC cannot pin the key's in-flight slot. A timeout is classified `indeterminate`. |
| `TRANSFER_ORCHESTRATION_MAX_KEY_LENGTH` | `255` | Upper bound on a client-supplied key. |

Both are read per call, so an operator can change them without a restart-time
re-import. The circuit breaker and idempotency TTL are configured by their own
modules (`CIRCUIT_BREAKER_*`, `IDEMPOTENCY_KEY_TTL_MS`).

## Durability note

The in-doubt registry is in-process, the same trade-off the withdrawal saga
journal and the dead-letter queue make. The `in_doubt` record that actually
enforces retry-safety lives in the idempotency store, which **is** shared across
replicas via Redis — so a pod recycle cannot turn a parked transfer back into a
resubmittable one. What a recycle loses is the operator *queue* view, not the
guarantee. Mirror the `transfer-in-doubt` alert to durable storage if you need
the queue to survive a restart.

## Usage

```ts
import { orchestrateTransfer } from './transferOrchestrator';

const { transactionHash, replayed } = await orchestrateTransfer(
  { operationType: 'deposit', walletAddress, amount: '1000', asset: 'USDC' },
  request.header('Idempotency-Key')!,
);
```

Call sites adopt the service by calling `orchestrateTransfer` in place of
`submitVaultOperation` and mapping the typed errors above onto responses.

## Tests

`src/__tests__/transferOrchestrator.test.ts` covers submission and replay,
concurrent coalescing, canonicalisation, wallet-scoped key isolation, conflict
detection, key/amount/wallet validation, each classification branch, fail-fast on
an open circuit, stored terminal rejections, the timeout path, and both in-doubt
resolutions — including the central assertion that a retry after an
indeterminate failure does **not** call the RPC a second time.
