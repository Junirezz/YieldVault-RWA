---
name: Performance Regression
about: Report a backend latency regression, memory leak, or throughput degradation
title: 'Perf: [Short description of performance regression]'
labels: 'type: perf, scope: backend, status: needs-triage'
assignees: 'YieldVault-RWA/backend-maintainers'
---

## ⚡ Summary
Provide a concise overview of the performance regression, when it was detected, and its impact on backend latency, throughput, or resource consumption.

## 🎯 Endpoint & Scope
- **Endpoint**: e.g. `POST /api/v1/vault/deposit` or `GET /api/v1/transactions`
- **Component Scope**: `scope: backend`
- **Environment**: Production / Staging / Testnet / Local
- **Deployment / Commit**: e.g. `sha-abcdef1` or `v1.4.2`

## ⏱️ Latency & Performance Metrics (p95 before/after)
- **p95 Before**: e.g. `45 ms` (historical baseline)
- **p95 After**: e.g. `380 ms` (observed degraded latency)
- **p99 Before / After**: e.g. `80 ms` / `750 ms`
- **Memory / CPU Impact**: e.g. Node process memory grew from 250MB to 1.8GB (suspected memory leak)

## 🚦 Traffic & Load (QPS)
- **QPS**: e.g. `250 req/s` (or traffic rate during regression)
- **Concurrency**: e.g. `50 concurrent connections`

## 🎯 Expected SLO
- **Expected SLO**: e.g. `Read P95 < 200 ms` / `Write P95 < 500 ms` (as defined in `docs/api/SLA_SLO.md` and `docs/nfr-baselines.json`)
- **Error Budget Impact**: e.g. Consuming 15% of monthly error budget / SLO breach

## 🗄️ DB Query Plan
Attach the `EXPLAIN ANALYZE` execution plan, Prisma query trace, or slow query log below:

```sql
-- Paste EXPLAIN ANALYZE or slow query plan here
```

## 🔄 Repro Steps
1. Configure load generator or HTTP client:
2. Execute command or load script (e.g. `k6 run load-test.js` or `autocannon -c 50 -d 30s <endpoint>`):
3. Send payload:
4. Observe latency metric spike or memory growth in metrics dashboard:

## 📊 Profiling & Diagnostic Evidence
- **Flamegraph / Profiler Trace**: (Attach SVG or link to CPU flamegraph/pprof trace)
- **Heap Snapshot / Memory Profile**: (Attach snapshot or leak analysis)
- **Grafana / Prometheus Dashboard Link**:
- **APM Trace IDs / OpenTelemetry Span**:

## 📝 Additional Context
Include any relevant recent PRs, schema migrations, database index changes, third-party RPC bottlenecks, or potential root cause hypotheses.
