# Operational Metrics & Health Monitoring

**Status**: Implementation Complete  
**Related Issues**: #1005 (Operational Metrics), #1006 (Health Dashboard)  
**Acceptance Criteria**: ✓ All criteria met

## Overview

Exposes high-level operational metrics for vault health monitoring and support visibility. Consolidates deposit, withdrawal, failure, and latency data into actionable dashboards designed for non-technical operators and support teams.

## Metrics Categories

### 1. Activity Metrics (24-hour rolling window)

#### Deposits
```
vault_activity_deposits_total_24h{vault_id="vault-123"}
  Type: Gauge
  Value: 152 (successful deposits)
  Unit: count
```

#### Withdrawals
```
vault_activity_withdrawals_total_24h{vault_id="vault-123"}
  Type: Gauge
  Value: 89 (successful withdrawals)
  Unit: count
```

#### Volume (USD)
```
vault_activity_volume_24h_usd{vault_id="vault-123"}
  Type: Gauge
  Value: 2500000 (deposit + withdrawal volume)
  Unit: USD
```

### 2. Failure Metrics

#### Failure Rate
```
vault_failure_rate{vault_id="vault-123", failure_type="total"}
  Type: Gauge
  Value: 2.5 (percentage)
  Range: 0-100
```

**Health Status Based on Rate**:
- 0-5%: ✓ Healthy
- 5-10%: ⚠ Degraded
- >10%: ✗ Unhealthy

#### Failure Count by Type
```
vault_failures_total_24h{vault_id="vault-123", failure_type="timeout"}
  Value: 4

vault_failures_total_24h{vault_id="vault-123", failure_type="insufficient_balance"}
  Value: 12

vault_failures_total_24h{vault_id="vault-123", failure_type="network_error"}
  Value: 2

vault_failures_total_24h{vault_id="vault-123", failure_type="signature_invalid"}
  Value: 1
```

### 3. Latency Metrics

#### P50 (Median)
```
vault_latency_p50_ms{vault_id="vault-123", operation="deposit"}
  Value: 245 ms
  Meaning: 50% of deposits complete in 245ms or less
```

#### P95 (95th percentile)
```
vault_latency_p95_ms{vault_id="vault-123", operation="deposit"}
  Value: 1250 ms
  Meaning: 95% of deposits complete in 1.25s or less
```

#### P99 (99th percentile)
```
vault_latency_p99_ms{vault_id="vault-123", operation="deposit"}
  Value: 3500 ms
  Meaning: 99% of deposits complete in 3.5s or less
```

### 4. Health Status

#### Vault Health
```
vault_health_status{vault_id="vault-123", reason="healthy"}
  Value: 1 (healthy)
            0.5 (degraded)
            0 (unhealthy)
```

#### System Health
```
system_health_status
  Value: 1 (all systems up)
         0.5 (some issues)
         0 (critical issues)
```

#### Dependency Health
```
system_dependency_health{dependency="database"}
  Value: 1 (up)
         0 (down)

system_dependency_health{dependency="soroban_rpc"}
  Value: 1 (up)
         0 (down)

system_dependency_health{dependency="redis"}
  Value: 1 (up)
         0 (down)
```

## Data Structures

### VaultActivitySummary
```typescript
{
  vaultId: "vault-123",
  tenantId: "tenant-456",
  
  // Activity
  depositsCount24h: 152,
  withdrawalsCount24h: 89,
  depositVolumeUsd: 1500000,
  withdrawalVolumeUsd: 1000000,
  
  // Failures
  failureCount24h: 12,
  failureRatePercent: 4.2,
  failuresByType: {
    "timeout": 4,
    "insufficient_balance": 5,
    "network_error": 2,
    "signature_invalid": 1
  },
  
  // Latency
  avgLatencyMs: 455,
  p50LatencyMs: 245,
  p95LatencyMs: 1250,
  p99LatencyMs: 3500,
  
  // Status
  health: "healthy",
  lastUpdated: "2026-08-25T10:30:00Z"
}
```

### SystemHealthSummary
```typescript
{
  // Overall
  status: "healthy",  // "healthy", "degraded", "critical"
  
  // Inventory
  vaultCount: 24,
  activeVaults: 22,   // TVL > 0
  totalTvlUsd: 250000000,
  totalUsers: 15420,
  
  // Dependencies
  dependencies: {
    "database": "up",
    "soroban_rpc": "up",
    "redis": "up"
  },
  
  // Issues
  failingEndpoints: ["POST /vault/deposit"],
  lastUpdated: "2026-08-25T10:30:00Z"
}
```

## API Endpoints

### Health Dashboard Endpoint

```
GET /admin/health/dashboard
Authorization: ApiKey sk-admin-...
Content-Type: application/json
```

**Response**:
```json
{
  "system": {
    "status": "healthy",
    "vaultCount": 24,
    "activeVaults": 22,
    "totalTvlUsd": 250000000,
    "totalUsers": 15420,
    "dependencies": {
      "database": "up",
      "soroban_rpc": "up",
      "redis": "up"
    },
    "failingEndpoints": [],
    "lastUpdated": "2026-08-25T10:30:00Z"
  },
  "vaults": [
    {
      "vaultId": "vault-123",
      "tenantId": "tenant-456",
      "depositsCount24h": 152,
      "withdrawalsCount24h": 89,
      "depositVolumeUsd": 1500000,
      "withdrawalVolumeUsd": 1000000,
      "failureCount24h": 12,
      "failureRatePercent": 4.2,
      "failuresByType": {
        "timeout": 4,
        "insufficient_balance": 5,
        "network_error": 2,
        "signature_invalid": 1
      },
      "avgLatencyMs": 455,
      "p50LatencyMs": 245,
      "p95LatencyMs": 1250,
      "p99LatencyMs": 3500,
      "health": "healthy",
      "lastUpdated": "2026-08-25T10:30:00Z"
    },
    // ... more vaults
  ],
  "generatedAt": "2026-08-25T10:30:00Z"
}
```

### Prometheus Metrics Endpoint

```
GET /metrics
```

**Includes**:
- Standard Prometheus metrics (requests, connections, etc.)
- Operational metrics (activity, failures, latency)
- Dependency health metrics
- System status gauge

## Data Synchronization

### Automatic Updates

Operational metrics sync every 60 seconds (configurable):

```typescript
// Start in index.ts
import { startOperationalMetricsSync } from './operationalMetrics';

const metricsInterval = startOperationalMetricsSync(60000); // 60 seconds

// On shutdown
process.on('SIGTERM', () => {
  clearInterval(metricsInterval);
  server.close();
});
```

### Manual Trigger

```bash
# Trigger metrics sync immediately
curl -X POST https://localhost:3000/admin/metrics/sync \
  -H "Authorization: ApiKey sk-admin-..." \
  -H "Content-Type: application/json"

# Response
{
  "status": "synced",
  "vaults": 24,
  "lastUpdated": "2026-08-25T10:30:00Z"
}
```

## Dashboard Integration

### Grafana Dashboard

Pre-built Grafana dashboard showing:

```json
{
  "dashboard": {
    "title": "YieldVault Operations",
    "panels": [
      {
        "title": "Vault Health Status",
        "targets": [
          {
            "expr": "vault_health_status"
          }
        ]
      },
      {
        "title": "24h Activity (Deposits)",
        "targets": [
          {
            "expr": "vault_activity_deposits_total_24h"
          }
        ]
      },
      {
        "title": "Failure Rate (%)",
        "targets": [
          {
            "expr": "vault_failure_rate"
          }
        ]
      },
      {
        "title": "P95 Latency (ms)",
        "targets": [
          {
            "expr": "vault_latency_p95_ms"
          }
        ]
      },
      {
        "title": "System Dependencies",
        "targets": [
          {
            "expr": "system_dependency_health"
          }
        ]
      }
    ]
  }
}
```

### DataDog Integration

```python
# datadog_exporter.py
import requests
from prometheus_client.parser import TextFileParser

metrics = get_prometheus_metrics()

datadog_client.metric('yieldvault.vault.health', 
  value=metrics['vault_health_status'],
  tags=['vault_id:vault-123']
)

datadog_client.metric('yieldvault.vault.failure_rate',
  value=metrics['vault_failure_rate'],
  tags=['vault_id:vault-123']
)
```

## Alert Thresholds

### Critical Alerts (page oncall)

| Metric | Threshold | Action |
|--------|-----------|--------|
| System Health | < 0.5 (degraded) | Page on-call engineer |
| Dependency Down | Any = 0 | Page on-call engineer |
| Failure Rate | > 10% for 5+ min | Page on-call engineer |
| P95 Latency | > 5000ms for 10+ min | Page on-call engineer |

### Warning Alerts (notify Slack)

| Metric | Threshold | Action |
|--------|-----------|--------|
| System Health | 0.5 (degraded) | Post to #alerts |
| Failure Rate | > 5% for 15+ min | Post to #alerts |
| P95 Latency | > 2500ms for 15+ min | Post to #alerts |
| Vault Inactive | TVL = 0 for 24h | Daily report |

## Usage Examples

### Support Team: Investigate Vault Issue

```
Support receives alert: "vault-123 failure rate > 10%"

1. Check dashboard:
   GET /admin/health/dashboard
   ↓
   Sees: 250 failures/24h, mostly "timeout" (200) and 
         "network_error" (50)

2. Correlate with:
   - P95 latency: 3500ms (normally 1250ms)
   - Soroban RPC dependency: DOWN
   
3. Action:
   - Escalate: "Soroban RPC unavailable"
   - Notify backend team
   - Update customer: "Experiencing delays due to RPC issues"

4. Resolution:
   - Soroban RPC restored
   - Failure rate returns to normal (4.2%)
   - Document in postmortem
```

### Operations: Monitor System Health

```
Morning standup check:

curl -s https://api.yieldvault.com/admin/health/dashboard | jq '.'

Output:
{
  "system": {
    "status": "healthy",
    "totalTvlUsd": 250000000,
    "dependencies": {
      "database": "up",
      "soroban_rpc": "up",
      "redis": "up"
    }
  },
  "vaults": [
    // All healthy
  ]
}

→ Everything normal, no action needed
```

### Engineering: Detect Performance Regression

```
Engineer reviews metrics trend:

Last 7 days P95 latency:
- Mon: 1100ms
- Tue: 1200ms
- Wed: 1850ms ← Spike after deployment
- Thu: 2100ms ← Getting worse
- Fri: 2300ms

Action:
1. Check deployment on Wed
2. Identify: New webhook signature validation logic
3. Optimize or rollback
4. Restore P95 to 1200ms
```

## Testing & Validation

### Unit Tests
```bash
npm test -- operationalMetrics.test.ts
```

Coverage:
- ✓ Activity metric collection (deposits, withdrawals)
- ✓ Failure rate calculation
- ✓ Latency percentile calculation
- ✓ Health status determination
- ✓ Dependency health aggregation

### Integration Tests
```bash
npm test -- integration/operational-metrics.test.ts
```

Scenarios:
- ✓ Metrics sync every 60 seconds
- ✓ Dashboard endpoint returns current data
- ✓ Health status updates correctly
- ✓ Failure rate threshold detection
- ✓ Latency trend tracking

### Manual Testing

```bash
# 1. Check Prometheus metrics
curl http://localhost:3000/metrics | grep "vault_"

# Output should include:
# vault_activity_deposits_total_24h{vault_id="vault-123",tenant_id="tenant-456"} 152
# vault_activity_withdrawals_total_24h{vault_id="vault-123",tenant_id="tenant-456"} 89
# vault_failure_rate{vault_id="vault-123",failure_type="total"} 4.2
# vault_latency_p95_ms{vault_id="vault-123",operation="deposit"} 1250

# 2. Check health dashboard
curl -H "Authorization: ApiKey sk-admin-..." \
  http://localhost:3000/admin/health/dashboard | jq '.system'

# 3. Monitor metrics sync
tail -f logs/backend.log | grep "metrics_sync"
```

## Performance Considerations

- **Collection overhead**: ~50-100ms per vault (DB queries)
- **Sync frequency**: 60 seconds (configurable)
- **Storage**: Metrics stored in-memory (Prometheus scrapes)
- **Historical retention**: Managed by Prometheus (default 15 days)

For high-scale deployments (100+ vaults):
- Consider sampling subset of vaults per sync
- Archive metrics to long-term storage
- Use metrics pre-aggregation

## Configuration

### Environment Variables

```bash
# Metrics sync interval (milliseconds)
METRICS_SYNC_INTERVAL_MS=60000

# Enable/disable operational metrics
OPERATIONAL_METRICS_ENABLED=true

# Latency threshold for "unhealthy" status (ms)
LATENCY_UNHEALTHY_THRESHOLD=5000

# Failure rate threshold for "unhealthy" (percent)
FAILURE_RATE_UNHEALTHY_THRESHOLD=10
```

## Data Privacy

- Metrics include aggregate counts, no PII
- Wallet addresses not exposed in metrics
- Tenant scope enforced (only authorized admins see metrics)
- No individual transaction details in metrics
- Historical metrics retained per data retention policy
