# Query Performance Budgets and Slow-Query Alerts

Issue #1050 establishes a single performance-budget boundary for both Prisma
operations and raw PostgreSQL queries routed through `DatabaseManager`.

## Runtime behavior

Every query records `db_query_duration_seconds` and publishes its active budget
through `db_query_budget_ms`. When duration is at least the budget:

1. `db_query_budget_breach_total` increments.
2. A structured `Database query exceeded budget` log is emitted without SQL
   text or bind parameters.
3. The breach is classified as `warning` or `critical`.
4. Slack and/or PagerDuty delivery is attempted after cooldown acquisition.

Alert delivery is asynchronous and never delays or changes the query result.
Failed queries are measured too, because a slow failure is still operationally
important.

## Budget resolution

Budget priority is:

1. Valid `QUERY_BUDGETS_JSON` exact override.
2. Built-in hot-path budget in `QUERY_BUDGETS`.
3. `QUERY_READ_BUDGET_MS` or `QUERY_WRITE_BUDGET_MS`.

Example:

```env
QUERY_READ_BUDGET_MS=100
QUERY_WRITE_BUDGET_MS=200
QUERY_BUDGETS_JSON={"User.findUnique":50,"Transaction.findMany":150,"raw_replica.select":400}
```

Override keys must use `Model.action` with alphanumeric/underscore segments.
Values must be finite positive numbers. Invalid entries are logged and ignored.

Raw PostgreSQL models are `raw_primary` and `raw_replica`. Their action is the
leading SQL keyword after comments, such as `select`, `with`, or `update`.
Neither SQL text nor parameters are placed in metrics or slow-query alerts.

## Severity and routing

A breach becomes critical when:

```text
duration / budget >= SLOW_QUERY_CRITICAL_MULTIPLIER
```

The default multiplier is `3`. Warning and critical alerts have separate
cooldowns, so a warning cannot suppress a later critical escalation.

```env
SLOW_QUERY_CRITICAL_MULTIPLIER=3
SLOW_QUERY_ALERT_COOLDOWN_MS=900000
SLOW_QUERY_ALERT_TIMEOUT_MS=5000
QUERY_ALERT_TYPE=both
SLOW_QUERY_SLACK_WEBHOOK_URL=https://hooks.slack.com/...
SLOW_QUERY_PAGERDUTY_INTEGRATION_KEY=...
```

Dedicated slow-query credentials fall back to the existing
`SLACK_WEBHOOK_URL` and `PAGERDUTY_INTEGRATION_KEY`. Non-2xx responses, network
failures, and timeouts are recorded as `delivery_failed`.

## Multi-instance cooldowns

When `REDIS_URL` is configured, cooldown acquisition uses atomic
`SET key 1 PX <cooldown> NX`. This limits a given query/severity alert to one
delivery across all backend replicas. If Redis is unavailable, the process
falls back to an in-memory cooldown so a single replica still cannot create an
alert storm.

## Operator response

For a warning:

1. Identify `model` and `action` in the alert.
2. Compare the budget gauge with P95 latency over the same interval.
3. Check database saturation, replica lag, connection-pool waits, and recent
   deployments.
4. Inspect an approved database query-statistics source. Application alerts
   intentionally omit SQL and parameters.

For a critical alert:

1. Follow the warning checks immediately.
2. Assess user-facing latency and error rate.
3. Consider disabling the affected background job or expensive endpoint.
4. Page the database/backend owner if the breach persists for two windows.

Do not raise budgets merely to silence alerts. Budget changes should include
before/after measurements and review of the affected query plan.
