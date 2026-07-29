# Incident Runbook — YieldVault RWA

**Purpose:** Production-ready incident triage runbook for on-call engineers.
**Audience:** All on-call engineers (first responder).
**Owner:** DevOps / Platform Team
**Last Updated:** July 29, 2026
**Related:**
[Runbooks Overview](./runbooks/README.md) ·
[Quick Reference](./runbooks/QUICK_REFERENCE.md) ·
[Escalation Matrix](./escalation-matrix.md) ·
[Incident Response (RPC/Delivery)](./incident_response_runbook.md) ·
[Postmortem Playbook](./postmortem-playbook.md) ·
[Triage Rotation Calendar](./TRIAGE_ROTATION_CALENDAR.md)

---

## 1. Severity Classification (Sev0–Sev3)

Classify every incident into one of four severity levels. When in doubt, **round up** — it is safer to downgrade later than to under-escalate a critical incident.

### Sev0 — Critical

| Criteria | Example Scenarios |
|----------|-------------------|
| Complete platform outage | All API routes returning 5xx; frontend unreachable |
| Funds at risk | Withdrawals debited on-chain but not received; unauthorized contract interaction |
| Data loss / corruption | Database unrecoverable; audit log gap exceeding 15-minute RPO |
| Active security breach | Key compromise; exploit in progress; unauthorized admin access |
| RPO exceeded | Data loss beyond the 15-minute Recovery Point Objective |

**Response SLA:** Acknowledge within **5 minutes**. Mitigation target: immediate, all hands.

**Ownership & Escalation:**
1. First responder acknowledges and pages Incident Commander + Security on-call immediately.
2. War room created (`#yieldvault-war-room`).
3. Domain SMEs (Contracts, Backend) paged.
4. Stakeholders notified via status page within 15 minutes.
5. Post-mortem required within 48 hours.

### Sev1 — High

| Criteria | Example Scenarios |
|----------|-------------------|
| Core feature unavailable | Deposits failing for all users; vault page not loading |
| Circuit breaker open | Soroban write path shedding load; 503s on critical endpoints |
| Widespread partial failure | > 20% of requests failing on a critical path |
| Degraded performance | P95 latency > 5× baseline for > 10 minutes |
| RPC provider outage | Primary RPC unresponsive; failover required |

**Response SLA:** Acknowledge within **15 minutes**. Mitigation target: 30–60 minutes.

**Ownership & Escalation:**
1. First responder acknowledges and pages Incident Commander.
2. Domain SMEs notified.
3. Status page update within 30 minutes.
4. Escalate to Sev0 if not mitigated within RTO (60 minutes).

### Sev2 — Medium

| Criteria | Example Scenarios |
|----------|-------------------|
| Non-critical feature broken | Portfolio history not loading; referral page error |
| Limited user scope | Single wallet or small subset affected |
| Workaround exists | Users can still perform core actions via alternate path |
| Non-production affected | Staging/testnet environment issues |
| Scheduled maintenance | Planned downtime communicated in advance |

**Response SLA:** Acknowledge within **1 hour**. Mitigation target: next business day.

**Ownership & Escalation:**
1. First responder may own; IC optional.
2. File a tracking issue; no war room required unless it escalates.
3. Escalate to Sev1 if scope widens or unresolved after 4 business hours.

### Sev3 — Low

| Criteria | Example Scenarios |
|----------|-------------------|
| Cosmetic / UI glitch | Visual layout issue; non-blocking console warning |
| Documentation gap | Outdated runbook step; missing error code entry |
| Flaky test | Intermittent CI failure with no production impact |
| Future risk | Deprecation warning; dependency EOL 6+ months out |

**Response SLA:** Acknowledge within **1 business day**. Mitigation target: current sprint or backlog.

**Ownership & Escalation:**
1. File a GitHub issue with `priority: low`.
2. No immediate action required; address in backlog grooming.
3. Escalate only if impact grows.

---

## 2. Detection & Triage Steps

### 2.1 Detection Sources

- **Monitoring alerts** — PagerDuty, Grafana, Prometheus (see [Monitoring & Observability](./MONITORING_OBSERVABILITY.md))
- **User reports** — Support tickets, social media, in-app feedback
- **Health check failures** — CI/CD pipeline or cron job detects degradation
- **Manual discovery** — On-call engineer notices anomalous metrics during routine review
- **Security scanning alerts** — `secret-scanning.yml`, `slither.yml`, `rust-security.yml`

### 2.2 First Responder Triage Flow (First 15 Minutes)

#### Step 1 — Acknowledge (T+0)

- Acknowledge the PagerDuty alert or Slack notification.
- Post in `#yieldvault-incidents`:
  ```
  🚨 ACKNOWLEDGED: [Alert name]
  Investigating — will update within 15 min.
  ```

#### Step 2 — Validate the Signal (T+0–5)

1. **Check dashboards.** Open Grafana and confirm the alerting metric is anomalous.
2. **Run health checks:**
   ```bash
   curl -s http://localhost:3000/health | jq .
   curl -s $STELLAR_RPC_URL -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
   ```
3. **Spot-check logs** for correlated errors around the alert time:
   ```bash
   journalctl -u yieldvault-backend --since "15 min ago" | grep -i "error\|fatal"
   ```
4. **If false alarm:** Post `✅ False alarm: [brief reason]` and close. File a ticket if the alert threshold needs tuning.

#### Step 3 — Determine Scope (T+5–10)

| Question | How to Answer |
|----------|---------------|
| What components are affected? | Check health endpoints for backend, DB, RPC, frontend. |
| Who is affected? | All users, a region, a single wallet? Query logs for unique affected addresses. |
| When did it start? | Correlate with deploy times, config changes, or external events. |
| Is it getting worse? | Check metric slope — flat, increasing, or recovering? |

#### Step 4 — Classify Severity (T+10–12)

Apply the severity criteria from §1. Be decisive — classify within 2 minutes and revise later if needed.

> **Decision shortcut:** If you hesitate between two levels, pick the higher one. Downgrading is a Slack message; upgrading is a page.

#### Step 5 — Escalate or Own (T+12–15)

| Severity | Action |
|----------|--------|
| **Sev0** | Page IC + domain SME + Security immediately. Start incident report. |
| **Sev1** | Page IC. Notify domain SMEs. Start incident report. |
| **Sev2** | Own it. File tracking issue. Notify team lead if not resolved within 1 hour. |
| **Sev3** | File a GitHub issue. No further immediate action. |

#### Step 6 — Engage the Right Playbook (T+15)

Use the quick-reference in §6 to jump to the appropriate domain playbook.

---

## 3. Initial Response Checklist

### First 15 Minutes

- [ ] Acknowledge the alert (PagerDuty / Slack).
- [ ] Post initial notification in `#yieldvault-incidents`.
- [ ] Validate the signal is not a false alarm.
- [ ] Determine scope (components, users, geography).
- [ ] Classify severity (Sev0–Sev3).
- [ ] Escalate per severity guidelines.
- [ ] Create incident channel / war room if Sev0 or Sev1.

### First Hour

- [ ] Engage the appropriate domain playbook.
- [ ] Execute mitigation steps.
- [ ] Provide status updates (every 15 min for Sev0, 30 min for Sev1).
- [ ] Verify mitigation is working.
- [ ] Update status page (if Sev0/Sev1).
- [ ] Start incident report document.

### Post-Mitigation

- [ ] Verify all metrics returned to baseline for at least 5 minutes.
- [ ] Run smoke-test suite:
  ```bash
  cd contracts && cargo test --workspace --quiet
  cd ../backend && npm test
  cd ../frontend && npm run test:run
  ```
- [ ] Re-enable any disabled services / circuit breakers.
- [ ] Monitor for residual errors for 30 minutes.
- [ ] Document the incident timeline, root cause, and actions taken.
- [ ] Schedule post-mortem (within 48 hours for Sev0/Sev1).

---

## 4. Escalation Paths

### Escalation Triggers

| Condition | Action |
|-----------|--------|
| Sev0 declared | Page IC + Security on-call immediately. |
| Sev1 not mitigated within 60 minutes | Escalate to Sev0; page IC if not already engaged. |
| Sev2 unresolved after 4 business hours | Notify team lead; escalate to Sev1 if scope widens. |
| Suspected contract / fund-safety issue | Page Contracts SME + IC regardless of severity. |
| Security scanning alert (High/Critical) | Follow [Security Scanning Guide](./SECURITY_SCANNING_GUIDE.md); page Security on-call. |

### Escalation Contacts

| Role | Channel / Contact |
|------|-------------------|
| Incident Commander | PagerDuty: "YieldVault IC" |
| Backend on-call | `#backend-oncall` |
| Contracts on-call | `#contracts-oncall` |
| Frontend on-call | `#frontend-oncall` |
| Platform / Infra | `#platform-oncall` |
| Security on-call | PagerDuty: "YieldVault Security" |

Full rotation schedule in [Triage Rotation Calendar](./TRIAGE_ROTATION_CALENDAR.md).

---

## 5. Communication Guidelines

### Incident Channel Etiquette

- **Do** keep all incident-related discussion in the designated channel.
- **Do** prefix messages with relevant labels (`[Triage]`, `[Action]`, `[Question]`).
- **Do** post links to dashboards, logs, and runbooks.
- **Don't** speculate on root cause in customer-facing status updates.
- **Don't** make unilateral changes without posting in the channel first.

### Severity-Based Communication Cadence

| Severity | Update Frequency | Audience | Channel |
|----------|-----------------|----------|---------|
| Sev0 | Every 15 minutes | All stakeholders | War room + status page |
| Sev1 | Every 30 minutes | Engineering + Product | Incident channel + status page |
| Sev2 | Every 1–2 hours | Engineering team | Incident channel |
| Sev3 | No cadence | Issue tracker | GitHub issue |

### Communication Templates

**Initial Acknowledgment (T+0–5):**
```
🚨 INCIDENT: [Brief one-liner]
Severity: [Investigating / Sev0 / Sev1 / Sev2]
Scope: [What's affected, how many users]
IC: [Name or "TBD"]
Channel: #yieldvault-war-room
Next update: [Time, within 15–30 min]
```

**Status Update:**
```
📊 UPDATE: [Incident name]
Severity: [Unchanged / Upgraded to SevX]
Progress: [Current action, blockers]
Mitigation ETA: [Time or "TBD"]
Next update: [Time]
```

**Mitigated:**
```
🔧 MITIGATED: [Incident name]
Action taken: [Brief description]
Monitoring: [Metrics being watched]
Canary status: [Passed / In progress]
Next: Verification + postmortem
```

**Resolved:**
```
✅ RESOLVED: [Incident name]
Duration: [Start → End UTC]
Severity: [Final]
Impact: [Users affected, data loss if any]
Root cause (initial): [One line]
Postmortem: [Ticket/PR link or "TBD within 48h"]
```

**Status Page (Customer-Facing):**
- **Investigating:** "We are investigating reports of [symptom]. Some users may experience [impact]. Funds remain secure. Next update in 30 minutes."
- **Identified:** "We have identified the cause as [brief]. Our team is working on a fix."
- **Monitoring:** "A fix has been deployed. We are monitoring closely to confirm resolution."
- **Resolved:** "This incident has been resolved. A full postmortem will be published within 5 business days."

---

## 6. Symptom → Playbook Quick Reference

| Symptom | Default Severity | Playbook |
|---------|-----------------|----------|
| All endpoints returning 5xx | Sev0 | [Backend Redeploy](./runbooks/BACKEND_REDEPLOY.md) |
| Database unreachable or corrupted | Sev0 | [Database Restore](./runbooks/DATABASE_RESTORE.md) |
| Funds at risk / unauthorized on-chain activity | Sev0 | [Contract Upgrade Playbook](./runbooks/CONTRACT_UPGRADE_PLAYBOOK.md) |
| Active security breach | Sev0 | [Full DR Procedure](./runbooks/FULL_DR_PROCEDURE.md) + Security |
| Primary RPC unresponsive / high latency | Sev1 | [RPC Failover](./runbooks/RPC_FAILOVER.md) |
| Withdrawals failing (funds not debited) | Sev1 | [Failed Withdrawal Playbook](./runbooks/FAILED_WITHDRAWAL_INCIDENT_PLAYBOOK.md) |
| Withdrawals debited on-chain, not received | Sev0 | [Failed Withdrawal Playbook](./runbooks/FAILED_WITHDRAWAL_INCIDENT_PLAYBOOK.md) + escalate immediately |
| Transaction delivery failures spiking | Sev1 | [Incident Response Runbook](./incident_response_runbook.md) |
| Specific error code (`SOROBAN_*`, `VAULT_*`) | Sev1/Sev2 | [Error Code Troubleshooting](./runbooks/ERROR_CODE_TROUBLESHOOTING.md) |
| Ledger event gap / email queue stuck | Sev2 | [Replay & State Recovery](./runbooks/REPLAY_PROCEDURES.md) |
| Contract upgrade failure / rollback needed | Sev0 | [Contract Upgrade Playbook](./runbooks/CONTRACT_UPGRADE_PLAYBOOK.md) |
| Complete infrastructure loss | Sev0 | [Full DR Procedure](./runbooks/FULL_DR_PROCEDURE.md) |
| CI/CD pipeline failure (non-production) | Sev2 | File issue; notify `#platform-oncall` |
| Security scanning alert (High/Critical) | Sev0/Sev1 | [Security Scanning Guide](./SECURITY_SCANNING_GUIDE.md) |
| Rate limiting / abuse pattern | Sev1 | Check `rateLimiter.ts`; page Backend on-call |

---

## 7. Post-Incident

- [ ] Validate the final severity classification — did it match impact?
- [ ] Ensure an incident report was filed and a post-mortem is scheduled (Sev0/Sev1).
- [ ] Review alert thresholds that triggered false positives and file tuning tickets.
- [ ] If this runbook was unclear or missing a path, update it in the same PR as post-mortem action items.
- [ ] Confirm the incident is linked in [`docs/incidents/README.md`](./incidents/README.md).

---

## 8. On-Call Readiness Checklist

Before your first on-call shift, confirm:

- [ ] You can access Grafana, PagerDuty, and the deployment dashboard.
- [ ] You have SSH / `kubectl` / cloud console access to production.
- [ ] You can run health checks:
  ```bash
  curl -s http://localhost:3000/health | jq .
  psql $DATABASE_URL -c "SELECT 1"
  curl -s $STELLAR_RPC_URL -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
  ```
- [ ] You know where backups are stored: `s3://yieldvault-backups/database/`
- [ ] You have read and understood this runbook and know the difference between Sev0, Sev1, Sev2, and Sev3.

---

**Last Updated:** July 29, 2026
**Maintained By:** DevOps / Platform Team
**Next Review:** October 29, 2026
