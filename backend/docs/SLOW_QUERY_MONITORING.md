# Slow Query Monitoring & Performance Budget Guide

## Overview

YieldVault implements query performance budgets to proactively identify slow database operations before they impact production. Each query type has a maximum allowed execution time; exceeding this triggers alerts and logging.

## Performance Budgets

### Default Budgets

| Operation Type | Budget | Notes |
|---|---|---|
| Read operations (find, count) | 100ms | Single record retrieval |
| Write operations (create, update) | 200ms | Data modification |
| Complex reads (findMany) | 150ms | Multiple records |
| Aggregations | 200ms | Group by, count, etc. |
| Transaction commit | 300ms | Multi-step transaction |

### Query-Specific Budgets

Built-in optimized budgets for hot paths:

```typescript
'User.findUnique': 50ms
'VaultState.findUnique': 50ms
'SharePriceSnapshot.create': 150ms
'Transaction.findMany': 150ms
'Referral.findUnique': 50ms
'WebhookEndpoint.findMany': 100ms
'WebhookDelivery.findMany': 150ms
```

### Custom Budgets via Environment

```bash
# JSON format with query names and budgets (ms)
QUERY_BUDGETS_JSON='{
  "User.findMany": 120,
  "VaultPosition.aggregate": 180,
  "CustomReport.generate": 500
}'
```

## Breach Severity

### Warning Level (1.0x - 2.0x budget)
- Logged as warning
- Tagged in metrics
- Rate-limited alerts (1 per 15 min per query)

**Example:** Query takes 150ms, budget is 100ms (1.5x)
- Severity: warning
- Alert sent to Slack (if configured)
- Metrics increment warning counter

### Critical Level (> 2.0x budget)
- Logged as error
- Immediate alert
- Escalated to PagerDuty (if configured)
- Performance investigation recommended

**Example:** Query takes 250ms, budget is 100ms (2.5x)
- Severity: critical
- Error logged
- Alert sent to Slack + PagerDuty
- Ops team notified

## Metrics Collection

### Prometheus Metrics

**Query Duration Histogram:**
```promql
# Histogram with buckets for latency analysis
db_query_duration_seconds_bucket{query_type="User.findUnique"}

# Access patterns:
histogram_quantile(0.95, db_query_duration_seconds_bucket{query_type="VaultState.findUnique"})
histogram_quantile(0.99, db_query_duration_seconds_bucket)
```

**Budget Breach Counter:**
```promql
# Count of queries exceeding budget
db_query_budget_breaches_total{query_type="Transaction.findMany", severity="warning"}
db_query_budget_breaches_total{query_type="Transaction.findMany", severity="critical"}
```

**Query Rate:**
```promql
# Queries per second by type
rate(db_queries_total{query_type="User.findUnique"}[5m])
```

### Example Prometheus Scrape Config

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'yieldvault-backend'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
```

## Alert Channels

### Slack Integration

Configured via `SLACK_WEBHOOK_URL` environment variable:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Alert Message Format:**
```
🚨 Critical Query Breach

Title: Database Performance Degradation
Severity: critical
Service: yieldvault-backend

Context:
{
  "query_type": "Transaction.findMany",
  "duration_ms": 450,
  "budget_ms": 150,
  "ratio": 3.0,
  "operation": "findMany",
  "model": "Transaction"
}
```

### PagerDuty Integration

Configured via `PAGERDUTY_INTEGRATION_KEY` environment variable:

```bash
PAGERDUTY_INTEGRATION_KEY=your-integration-key
```

**PagerDuty Event:**
- Severity: critical (for budget breach > 2x)
- Summary: "Database query exceeded performance budget"
- Service: yieldvault-backend
- Custom details: query context, duration, budget

### Console Logging

All budget breaches logged via structured logger:

```json
{
  "level": "warn",
  "message": "Query budget exceeded",
  "query_type": "VaultPosition.aggregate",
  "duration_ms": 175,
  "budget_ms": 100,
  "ratio": 1.75,
  "severity": "warning"
}
```

## Grafana Dashboard Queries

### Setup

1. Add Prometheus data source pointing to your Prometheus server
2. Create new dashboard with following panels

### Panel 1: Query Duration by Type (95th Percentile)

```promql
histogram_quantile(0.95, 
  sum(rate(db_query_duration_seconds_bucket[5m])) by (query_type, le)
)
```

**Visualization:** Graph
**Time Range:** Last 1 hour
**Y-axis:** Duration (seconds)

### Panel 2: Budget Breach Rate

```promql
sum(rate(db_query_budget_breaches_total[5m])) by (query_type, severity)
```

**Visualization:** Graph
**Stacking:** Enabled (to show warning + critical stacked)
**Y-axis:** Breaches per second

### Panel 3: Top Slow Queries (Current)

```promql
topk(10,
  histogram_quantile(0.99, 
    sum(db_query_duration_seconds_bucket) by (query_type, le)
  )
)
```

**Visualization:** Table
**Columns:** query_type, duration, budget, ratio

### Panel 4: Query Latency Heatmap

```promql
db_query_duration_seconds_bucket{query_type!=""}
```

**Visualization:** Heatmap
**Legend:** Off
**Shows:** Distribution of query latencies over time

## Operational Procedures

### Identifying Slow Queries

**Check current slow queries:**
```bash
curl http://localhost:9090/api/v1/query?query=
'db_query_budget_breaches_total{severity="critical"}'
```

**Export query performance data:**
```bash
# Last 24 hours
curl -G 'http://localhost:9090/api/v1/query_range' \
  --data-urlencode 'query=db_query_duration_seconds' \
  --data-urlencode 'start=2024-08-24T00:00:00Z' \
  --data-urlencode 'end=2024-08-25T00:00:00Z' \
  --data-urlencode 'step=5m'
```

### Investigating a Slow Query

**Step 1:** Identify query from alert
```
Example: "Transaction.findMany taking 450ms (budget: 150ms)"
```

**Step 2:** Find query in code
```bash
grep -r "Transaction.findMany" src/
```

**Step 3:** Check usage pattern
```typescript
// src/transactionEndpoints.ts
const transactions = await prisma.transaction.findMany({
  where: { vaultId, status: 'pending' },
  include: { transfers: true, fees: true }, // N+1 problem?
  take: 1000,
});
```

**Step 4:** Review database indices
```sql
SELECT * FROM pg_indexes WHERE tablename = 'Transaction';

-- Add missing index
CREATE INDEX idx_transaction_vault_status 
  ON "Transaction"(vaultId, status);
```

**Step 5:** Verify improvement
```typescript
// Monitor improved query duration in Prometheus
histogram_quantile(0.95, 
  db_query_duration_seconds_bucket{query_type="Transaction.findMany"}
)
```

### Adjusting Performance Budgets

**When budgets are consistently exceeded:**

1. **Validate it's not a regression**
   ```bash
   # Compare against 7 days ago
   rate(db_query_budget_breaches_total[1d] offset 7d)
   ```

2. **Determine root cause:**
   - Data volume increased?
   - New complex query added?
   - Database performance degraded?
   - Index missing or fragmented?

3. **Update budget if appropriate:**
   ```bash
   # Only after optimization attempts
   QUERY_BUDGETS_JSON='{
     "Transaction.findMany": 200  # Increased from 150
   }'
   ```

4. **Document decision:**
   ```markdown
   ## Budget Update: Transaction.findMany → 200ms

   **Reason:** Data volume increased 5x due to new vault operations
   **Optimization attempted:** Added composite index (vaultId, status)
   **Result:** Improved from 180ms p95 to 160ms p95
   **Budget increase justified:** Legitimate workload increase
   **Monitoring:** Alert if ratio > 2.5x budget
   ```

## Performance Optimization Guide

### Common Slow Query Patterns

#### N+1 Problem
**Problem:** Fetching parent, then looping to fetch children
```typescript
// ❌ Bad: N+1 query
const vaults = await prisma.vault.findMany();
for (const vault of vaults) {
  vault.allocations = await prisma.allocation.findMany({
    where: { vaultId: vault.id }
  }); // N queries
}

// ✅ Good: Single query with include
const vaults = await prisma.vault.findMany({
  include: { allocations: true }
});
```

#### Missing Index
```typescript
// ❌ Bad: Slow filter
const recent = await prisma.transaction.findMany({
  where: { createdAt: { gte: Date.now() - 24*60*60*1000 } }
});

// ✅ Good: Add index
// CREATE INDEX idx_transaction_created_at ON "Transaction"(createdAt);
```

#### Excessive Joins
```typescript
// ❌ Bad: Loading unnecessary relations
const transfers = await prisma.transfer.findMany({
  include: {
    vault: { include: { positions: true } },
    strategy: { include: { metrics: true } }
  },
  take: 1000
});

// ✅ Good: Only include needed fields
const transfers = await prisma.transfer.findMany({
  select: {
    id: true,
    amount: true,
    vaultId: true,
    vault: { select: { name: true } }
  },
  take: 100
});
```

#### Inefficient Pagination
```typescript
// ❌ Bad: Using offset (scans all previous rows)
const page = await prisma.transaction.findMany({
  skip: 10000,
  take: 50
});

// ✅ Good: Cursor-based pagination
const page = await prisma.transaction.findMany({
  cursor: { id: lastId },
  skip: 1,
  take: 50
});
```

## Alert Response Runbook

### On Critical Alert

1. **Check alert context**
   - Which query is slow?
   - How much over budget?
   - When did it start?

2. **Quick triage** (5 min)
   - Check database server metrics (CPU, I/O)
   - Check query plan: `EXPLAIN ANALYZE <query>`
   - Check table statistics current: `ANALYZE <table>`

3. **Immediate actions** (15 min)
   - If infrastructure issue: scale up resources
   - If stale stats: run `ANALYZE` command
   - If lock contention: check active sessions

4. **Root cause investigation** (30 min)
   - Review query plan
   - Check for new data patterns
   - Verify indices present and used
   - Review recent code changes

5. **Resolution** (1-4 hours)
   - Add missing indices
   - Optimize query logic
   - Adjust performance budget if appropriate
   - Deploy fix and verify improvement

### Ongoing Monitoring

**Daily:**
- Review Slack alerts from previous day
- Check budget breach trends

**Weekly:**
- Run slow query analysis report
- Review query performance trends
- Plan optimization work

**Monthly:**
- Full performance review meeting
- Capacity planning based on trends
- Update runbooks based on incidents

## Configuration Reference

```typescript
// src/queryBudgets.ts
export const DEFAULT_READ_QUERY_BUDGET_MS = 100;
export const DEFAULT_WRITE_QUERY_BUDGET_MS = 200;
export const DEFAULT_ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min
export const DEFAULT_ALERT_TIMEOUT_MS = 5000;
export const DEFAULT_CRITICAL_MULTIPLIER = 3; // > 3x budget = critical

// Built-in query-specific budgets
export const QUERY_BUDGETS = {
  'User.findUnique': 50,
  'VaultState.findUnique': 50,
  'SharePriceSnapshot.create': 150,
  'Transaction.findMany': 150,
  // ... more
};
```

## References

- [PostgreSQL Query Planning](https://www.postgresql.org/docs/current/sql-explain.html)
- [Prisma Query Optimization](https://www.prisma.io/docs/concepts/components/prisma-client/performance-optimization)
- [Prometheus Histogram Queries](https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile)
- [Database Performance Tuning Guide](https://use-the-index-luke.com/)
