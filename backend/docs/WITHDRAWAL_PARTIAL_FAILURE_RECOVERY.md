# Withdrawal Partial-Failure Recovery (Issue #954)

A withdrawal is not one write. It submits an on-chain transaction, persists a
transaction row, re-prices the vault, and notifies downstream consumers. Any of
those steps can fail on its own, and exactly one of them — the on-chain
submission — cannot be undone.

Before this change a failure between the submission and the ledger writes left
the system inconsistent (funds moved on chain, ledger untouched) and returned a
bare `500`, which told the client the opposite of what had happened. There was no
record of how far the withdrawal got and no way to finish it.

`src/withdrawalRecovery.ts` adds a journalled saga coordinator that closes that
gap.

## How it works

### 1. Write-ahead journal

`coordinator.begin()` writes the saga and every one of its steps as `pending`
**before the first side effect runs**. Each transition (`in_progress` →
`completed` / `failed` / `compensated`) is written as it happens, so a crash
always leaves evidence of how far the withdrawal got.

### 2. Resume-forward, never repeat

A recovery pass re-walks the plan and skips any step already marked `completed`
or `skipped`. The on-chain step is declared `irreversible` and pinned to
`maxAttempts: 1`, so a submission is never repeated — a second submission could
move funds twice.

### 3. Retry with capped backoff

A retryable failure with attempts left parks the saga as `awaiting_retry` with
`nextAttemptAt = now + min(maxBackoff, base × 2^(attempt-1))`. Nothing sleeps in
the request path: the request returns immediately and a background sweeper picks
the saga up when it is due.

### 4. Compensation

When the failure happened *before* any irreversible progress, completed steps are
compensated in reverse order and the saga ends as `compensated` — no residue. If
a compensating action itself fails, the saga escalates instead of pretending the
rollback worked.

### 5. Manual-intervention queue

When irreversible progress exists and the remaining steps cannot be completed,
the saga is parked as `needs_manual_intervention`, logged at `error` with
`alert: "withdrawal-partial-failure"`, counted in
`withdrawal_saga_manual_intervention_required`, and exposed to operators. It is
never silently dropped, and it is never evicted by journal retention.

## Saga states

| Status | Meaning | Next action |
| --- | --- | --- |
| `in_progress` | Steps are running now | None; the sweeper recovers it if the process dies |
| `completed` | Every required step completed | None |
| `awaiting_retry` | Retryable failure, attempts remain | Sweeper resumes at `nextAttemptAt` |
| `compensated` | Completed steps were undone cleanly | None; the client saw an error and nothing happened |
| `needs_manual_intervention` | Irreversible partial state | Operator: reconcile, then resume or resolve |
| `failed` | Failed before anything durable happened | None; the client saw the original error |

## The withdrawal plan

Registered by `src/vaultEndpoints.ts` as `vault.withdrawal`:

| Step | Irreversible | Attempts | Compensation |
| --- | --- | --- | --- |
| `chain_submit` | yes | 1 | none possible |
| `persist_transaction` | no | 3 | mark the row `reversed` |
| `vault_state_update` | no | 3 | re-add the assets/shares and snapshot the reversal |

`persist_transaction` upserts on a transaction id derived from the withdrawal
identity (`wd_<sha256(withdrawalId)>`), so a retry after a commit-then-fail can
never insert a duplicate row. `vault_state_update` runs inside a single Prisma
transaction, so a failure applies nothing and a retry cannot double-apply.

## API behaviour

`POST /api/v1/vault/withdrawals` is unchanged on the happy path (`201`) and for
failures that left nothing behind — a rejected simulation is still `422`, an open
circuit still `503`.

What changed is the partial-failure case. When the on-chain leg succeeded but the
ledger did not catch up, the endpoint returns **`202 Accepted`** with a recovery
handle instead of a misleading `500`:

```json
{
  "id": "idem-key-or-generated-id",
  "type": "withdrawal",
  "amount": 50,
  "asset": "USDC",
  "walletAddress": "G...",
  "transactionHash": "e3b0c44298fc1c14…",
  "status": "recovering",
  "recovery": {
    "sagaId": "wsaga_9f2c…",
    "status": "awaiting_retry",
    "automatedRetryScheduled": true,
    "nextAttemptAt": "2026-07-28T09:50:00.000Z",
    "failedStep": "persist_transaction",
    "steps": [
      { "name": "chain_submit", "status": "completed" },
      { "name": "persist_transaction", "status": "failed" },
      { "name": "vault_state_update", "status": "pending" }
    ]
  },
  "timestamp": "2026-07-28T09:49:54.552Z"
}
```

Clients should treat `202` as "the withdrawal is happening; poll your transaction
list or wait for the `transaction.withdrawal.created` webhook", not as a failure
to retry blindly.

### Idempotency

Supplying `Idempotency-Key` makes the key the saga identity. A retry with the
same key resumes the journalled saga rather than starting a second on-chain
submission, and a saga parked for an operator is never auto-advanced by an
inbound request. Without a key, each request is a distinct withdrawal — exactly
as before.

## Admin endpoints

All require an admin API key.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/withdrawals/recovery` | List sagas. Filters: `status`, `walletAddress`, `withdrawalId`, `requiresManualIntervention`, `limit` |
| `GET` | `/admin/withdrawals/recovery/metrics` | Aggregate recovery counters |
| `GET` | `/admin/withdrawals/recovery/:sagaId` | Full step journal for one saga |
| `POST` | `/admin/withdrawals/recovery/:sagaId/resume` | Run one recovery pass. Body: `{ "force": true }` to resume a parked saga |
| `POST` | `/admin/withdrawals/recovery/:sagaId/resolve` | Close out a reconciled saga. Body: `{ "note": "…", "outcome": "completed" \| "compensated" \| "failed" }` (`note` required) |
| `POST` | `/admin/withdrawals/recovery/sweep` | Run a sweep immediately |

`resume` and `resolve` write admin audit log entries
(`withdrawal-recovery.resumed`, `withdrawal-recovery.resolved`).

## Metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `withdrawal_saga_total` | counter | `plan`, `outcome` |
| `withdrawal_saga_step_failure_total` | counter | `step`, `classification` |
| `withdrawal_saga_compensation_total` | counter | `step`, `result` |
| `withdrawal_saga_retry_total` | counter | `plan` |
| `withdrawal_saga_awaiting_recovery` | gauge | — |
| `withdrawal_saga_manual_intervention_required` | gauge | — |

Suggested alerts:

- `withdrawal_saga_manual_intervention_required > 0` — page. Money moved on chain
  and the ledger is not consistent.
- `increase(withdrawal_saga_total{outcome="compensated"}[15m])` above baseline —
  a downstream dependency is failing withdrawals late.
- `withdrawal_saga_awaiting_recovery` sustained above zero — the sweeper is not
  keeping up, or a step keeps failing retryably.

## Failure classification

`classifyWithdrawalFailure()` decides retryable vs terminal, in order:

1. `error.retryable` (explicit boolean wins outright)
2. `error.code` — socket/DNS codes and Prisma connection/pool codes
   (`P1001`, `P2024`, `P2034`, …) and `SOROBAN_CIRCUIT_OPEN` are retryable;
   `VALIDATION_*`, `INSUFFICIENT_*`, `NOT_FOUND`, `CONFLICT`, … are terminal
3. `error.statusCode` — `429` and `5xx` retryable, other `4xx` terminal
4. Message match on timeout/connection/deadlock/serialization wording
5. Otherwise **retryable**

Defaulting unknown failures to retryable is safe: attempts are capped per step,
irreversible steps are never repeated, and an exhausted saga still lands in the
manual-intervention queue rather than disappearing.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WITHDRAWAL_RECOVERY_MAX_STEP_ATTEMPTS` | `3` | Attempts per reversible step (irreversible steps are always 1) |
| `WITHDRAWAL_RECOVERY_MAX_ATTEMPTS` | `5` | Automated recovery passes per saga |
| `WITHDRAWAL_RECOVERY_BASE_BACKOFF_MS` | `2000` | First backoff |
| `WITHDRAWAL_RECOVERY_MAX_BACKOFF_MS` | `60000` | Backoff ceiling |
| `WITHDRAWAL_RECOVERY_STALE_MS` | `120000` | `in_progress` sagas older than this are treated as crashed |
| `WITHDRAWAL_RECOVERY_SWEEP_MS` | `15000` | Sweeper interval |
| `WITHDRAWAL_RECOVERY_MAX_PER_SWEEP` | `25` | Sagas resumed per sweep |
| `WITHDRAWAL_RECOVERY_RETENTION` | `1000` | Journal ring-buffer size (sagas needing action are never evicted) |

The sweeper starts automatically unless `NODE_ENV=test`, where suites drive
`coordinator.sweep()` explicitly.

## Operator runbook

When `withdrawal_saga_manual_intervention_required` fires:

1. **Find it.** `GET /admin/withdrawals/recovery?requiresManualIntervention=true`
2. **Read the journal.** `GET /admin/withdrawals/recovery/:sagaId` — `steps[]`
   shows exactly which step failed, `state.txHash` is the on-chain transaction,
   `lastError` carries the message, code, and classification.
3. **Verify on chain.** Confirm `state.txHash` succeeded. If it did not, the
   withdrawal never moved funds and the saga can be resolved as `failed`.
4. **Fix the blocker** (database back up, constraint corrected, …).
5. **Resume.** `POST /admin/withdrawals/recovery/:sagaId/resume` with
   `{"force": true}`. Completed steps are skipped, so this is safe to repeat.
6. **If a resume cannot work** — say the row was written by hand — record what
   you did: `POST /admin/withdrawals/recovery/:sagaId/resolve` with a `note` and
   the outcome. The note and actor are stored on the saga and in the admin audit
   log.

Never re-issue the withdrawal request to "finish" a parked saga: the saga already
holds the on-chain transaction, and a fresh request without the original
idempotency key would submit again.

## Concurrency note

The per-wallet lock is held only for the duration of the inbound request, so a
recovery pass runs without it. That is safe because every recoverable step is
either idempotent (`persist_transaction` upserts a deterministic id) or atomic
(`vault_state_update` reads and writes inside one Prisma transaction).

A saga is also never advanced by two passes at once. The coordinator tracks
in-flight saga ids and returns the current state instead of executing when a pass
is already running, so an interval sweep racing an admin resume (or an inbound
retry) cannot run the same step twice. Sweeps themselves do not overlap either: a
tick that fires while the previous sweep is still running is a no-op.

## Durability note

The journal is a bounded in-process ring buffer, the same trade-off the
write-ahead audit log and dead-letter queue make. This survives a *failed step*
and a *stale in-flight saga within one process*, but not a pod restart.

`coordinator.setJournalSink(fn)` receives every transition so a deployment can
mirror the journal to Postgres or Redis without changing this module. Wiring a
durable sink is the recommended follow-up before relying on cross-restart
recovery in production.

## Tests

- `src/__tests__/withdrawalRecovery.test.ts` — the engine, driven with synthetic
  plans so failures can be placed at exact step boundaries: journalling,
  resume-forward, no-double-submit, compensation ordering, compensation failure,
  optional steps, duplicate suppression, backoff, crash recovery, recovery
  budget, overlapping passes, operator actions, metrics, failure classification.
- `src/__tests__/withdrawalRecoveryEndpoint.test.ts` — the endpoint, with the
  vault router mounted on a local Express app and Prisma mocked: the `202`
  recovery response, completion on the next pass with a single on-chain
  submission, the deterministic upsert id, parking after exhausted retries, clean
  rollback with the original `422` preserved, client retry safety, and deposits
  staying on the original non-journalled path.

The admin endpoints are thin wrappers over coordinator methods
(`list`, `get`, `getMetrics`, `resume`, `resolveManually`, `sweep`), each covered
by the engine suite. They are not currently exercised over HTTP because
`src/index.ts` cannot be imported from a test — it exports no app, and a
duplicated `AsyncMutex` declaration in `src/walletNonce.ts` throws on import.
Both are pre-existing breakages outside this change; once they are fixed, an HTTP
test for the admin surface should be added.
