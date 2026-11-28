# Backend Prometheus Alert Runbook

These alerts enforce the backend operational SLOs below. Prometheus rule annotations link to the relevant response section.

| Signal | SLO / threshold |
| --- | --- |
| Background jobs | Every registered job remains healthy; no sustained dead-letter backlog |
| Event outbox | Oldest pending or retrying event remains under 60 seconds; backlog stays at or below 100 |
| Event poller | Lag stays at or below 100 ledgers (about 8 minutes); a successful poll completes at least every 5 minutes |
| Email queue | Oldest queued or retrying email remains under 5 minutes; backlog stays at or below 100 |
| Webhook delivery | No failed deliveries remain unresolved; pending backlog stays at or below 100 |
| Database queries | P95 query latency remains below 1 second; no sustained query-budget breaches |
| Database backups | Scheduled backup job remains healthy |

## Background Jobs

1. Check `/admin/jobs/monitor` and `/admin/jobs/metrics` for the unhealthy job, recurring failures, and dead letters.
2. Inspect the job's logs and dependency health. Resolve the underlying cause before retrying or discarding dead-letter work.
3. For `databaseBackup`, verify `BACKUP_ENABLED`, the S3 bucket/endpoint/credentials, and the most recent object in the configured backup destination. Do not mark the job healthy until a usable backup is confirmed.

## Webhooks And Event Outbox

1. Check `/admin/jobs/monitor` for webhook delivery metrics and inspect the admin webhook delivery/dead-letter endpoints.
2. Check event outbox entries for pending, failed, or dead-lettered records. Verify downstream webhook endpoint health and delivery secrets.
3. Restore downstream availability, then retry only the affected dead-letter records. Confirm that backlog age and count return below the SLO.

## Event Poller

The Soroban event poller exposes these gauges on `/metrics`. Each carries a constant `poller="event"` label (plus the default `app` label) and no per-vault or per-contract labels, so cardinality stays flat.

| Metric | Meaning |
| --- | --- |
| `event_poller_lag_ledgers` | Latest ledger observed on the RPC minus the last processed ledger, never negative |
| `event_poller_last_processed_ledger` | Sequence of the last processed ledger (the persisted cursor) |
| `event_poller_last_successful_poll_timestamp_seconds` | Unix time of the last successful poll |

Behavior to know when reading them:

- Series are in-process. After a restart they are absent until the poller makes its first observation, rather than reading 0. Treat a missing series on a node that should be leader as a signal, not as "no lag".
- Only the leader instance polls, so only the leader exports series. Followers export nothing. Query without per-instance assumptions (for example `max(event_poller_lag_ledgers)`).
- Stopping the poller removes its series.
- The lag is updated as soon as the latest ledger is read, before events are processed. A poll that keeps failing therefore shows rising lag rather than a flat value.

Alerts (see `backend/monitoring/prometheus-alerts.yml`):

| Alert | Condition | Severity |
| --- | --- | --- |
| `YieldVaultEventPollerLagHigh` | Lag above 100 ledgers (about 8 minutes) for 10 minutes | warning |
| `YieldVaultEventPollerLagCritical` | Lag above 1000 ledgers (about 80 minutes) for 15 minutes | critical |
| `YieldVaultEventPollerStalled` | No successful poll for over 5 minutes, for 5 minutes | critical |

The `for:` windows are deliberate: lag spikes briefly during catch-up after a restart or RPC blip, and only sustained lag needs a human. Tune the thresholds to your poll interval and ledger close time (about 5 seconds).

Response:

1. Check which condition fired. Rising lag with a recent success timestamp means the poller is working but cannot keep up. A stale success timestamp means polls are failing or no instance holds leadership.
2. Look at the poller logs for `Event polling failed` and its error, and check `/health` for `consecutiveFailures`. Verify Soroban RPC availability and rate limits.
3. Confirm exactly one instance holds the `event-polling:leader-lock` Redis key and that Redis is reachable. If no instance is leader, restore Redis or restart an instance.
4. If lag is large after an outage, the poller replays from the persisted cursor on its own. If it is not shrinking, check the batch size and RPC latency, or use the admin range-replay endpoint for a specific gap.
5. Confirm `event_poller_lag_ledgers` is back under 100 and the success timestamp is advancing.

## Email Queue

1. Inspect `/admin/emails/queue` and worker logs for retry counts and the latest delivery errors.
2. Verify the mail provider configuration and connectivity. Replay dead-lettered messages only after the provider issue is resolved.
3. Confirm queue age and pending count return below the SLO.

## Database And Dependencies

1. Compare P95 query latency and budget-breach metrics by Prisma model/action; correlate with database CPU, connection saturation, and slow-query logs.
2. Check database connectivity, pool configuration, and recent migrations. Reduce the offending query load or address the slow query before scaling the pool.
3. For external dependency latency, check the affected provider's status and dependency-specific operations before changing retry settings.

## Alert Validation

The backend governance workflow runs `promtool check rules` against `backend/monitoring/prometheus-alerts.yml` on backend changes.
