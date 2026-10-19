# Backend Prometheus Alert Runbook

These alerts enforce the backend operational SLOs below. Prometheus rule annotations link to the relevant response section.

| Signal | SLO / threshold |
| --- | --- |
| Background jobs | Every registered job remains healthy; no sustained dead-letter backlog |
| Event outbox | Oldest pending or retrying event remains under 60 seconds; backlog stays at or below 100 |
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
