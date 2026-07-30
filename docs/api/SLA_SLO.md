# API SLA/SLO Targets

This document defines the formal Service Level Agreements (SLA) and Service Level Objectives (SLO) for the `YieldVault-RWA` backend API, establishing target uptime/availability, read/write latencies (at P95 and P99 percentiles), error budgets, and alerting thresholds.

---

## 1. Purpose & Scope

To ensure a high-quality user experience and predictable performance for integrated applications, the YieldVault backend API is governed by strict reliability and speed targets. These objectives guide on-call engineers, developers, and operators in system maintenance, deployment gates, and incident responses.

All API endpoints listed in the [Endpoint SLA Registry](file:///c:/Users/BUMBLECODE/Documents/Projects/YieldVault-RWA/backend/src/endpointSlaRegistry.ts) are subject to these targets.

---

## 2. Service Level Objectives (SLO) & Service Level Indicators (SLI)

### 2.1 Uptime / Availability SLO

API uptime is evaluated as the proportion of successful HTTP requests (excluding client-side 4xx errors) over a rolling 30-day window.

- **Uptime Target**: **99.9%** availability (Tier 2 baseline).
- **Max Permitted Downtime**: 43.8 minutes per month.
- **Evaluation Mechanism**: Inbound status health checks (`GET /health` and `GET /ready`) measured via external uptime monitors.

### 2.2 Latency SLOs

Latency targets are monitored using a rolling 5-minute window for all API requests. We measure latency at both the **95th percentile (P95)** and the **99th percentile (P99)** to bound worst-case tail performance.

| Traffic Category                     | Endpoints Included                                                                                                          | P95 Target   | P99 Target    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------- |
| **Read Requests (GET)**              | `/api/v1/vault/summary`, `/api/v1/vault/metrics`, `/api/v1/vault/apy`, `/api/v1/vault/:id`, `/health`, `/ready`, `/metrics` | **< 200 ms** | **< 500 ms**  |
| **Write Requests (POST/PUT/DELETE)** | `/api/v1/vault/deposit`, `/api/v1/vault/withdraw`, `/admin/cache/invalidate`, `/admin/api-keys/register`                    | **< 500 ms** | **< 1200 ms** |

---

## 3. Alerting and Error Budget Policy

### 3.1 Monthly Error Budget

The monthly error budget represents the allowed rate of service failure. For a 99.9% availability target, the error budget is **0.1%** of all API requests.

### 3.2 Burn Rate Alert Triggers

If a sudden spike in errors or latency consumes the error budget too quickly, alerts are dispatched to maintainers:

- **Fast Burn (P0 / Critical)**: **2%** of the monthly budget consumed in **1 hour**.
  - _Response_: High-priority pager notification via PagerDuty. Immediate deployment freeze.
- **Slow Burn (P1 / High)**: **5%** of the monthly budget consumed in **6 hours**.
  - _Response_: Standard alert via Slack/PagerDuty. Ticket scheduled in current sprint.

For details on alert configurations, refer to the [Latency Monitoring Guide](file:///c:/Users/BUMBLECODE/Documents/Projects/YieldVault-RWA/backend/LATENCY_MONITORING.md).

---

## 4. Automated Verification

The reliability targets specified here are stored as machine-readable configuration in [`docs/nfr-baselines.json`](file:///c:/Users/BUMBLECODE/Documents/Projects/YieldVault-RWA/docs/nfr-baselines.json) and are programmatically validated.

Run the NFR baselines validator to verify compliance:

```bash
npm run validate:nfr-baselines
```

This validation runs automatically as part of the continuous integration (CI) pipeline to guarantee documentation and configuration stay in sync.
