# RTO/RPO Targets - YieldVault Disaster Recovery

**Document Version:** 1.0  
**Last Updated:** April 29, 2026  
**Owner:** DevOps Team  
**Approved By:** [Team Lead Signature Required]

---

## Executive Summary

This document defines the Recovery Time Objective (RTO) and Recovery Point Objective (RPO) targets for the YieldVault platform. These targets guide disaster recovery planning and resource allocation.

---

## Definitions

### Recovery Time Objective (RTO)
The maximum acceptable time that a system can be down after a failure or disaster occurs. This is the target time for restoring service.

### Recovery Point Objective (RPO)
The maximum acceptable amount of data loss measured in time. This determines how frequently backups must be taken.

---

## System Components

YieldVault consists of the following critical components:

1. **Smart Contracts** (Soroban on Stellar)
   - Vault contract
   - Strategy contracts
   - Immutable once deployed

2. **Backend API** (Node.js/Express)
   - REST API endpoints
   - Database connections
   - External integrations

3. **Database** (PostgreSQL/SQLite)
   - User data
   - Transaction history
   - Vault state cache
   - Audit logs

4. **Frontend** (React/Vite)
   - Static assets
   - CDN-hosted
   - Stateless

5. **External Dependencies**
   - Stellar RPC nodes
   - Email service (Resend)
   - Monitoring (Slack, PagerDuty)

---

## RTO/RPO Targets by Component

### 1. Smart Contracts (Soroban)

| Metric | Target | Justification |
|--------|--------|---------------|
| **RTO** | N/A (Immutable) | Contracts are immutable on-chain; no recovery needed |
| **RPO** | N/A (Immutable) | Contract state is on-chain and cannot be lost |
| **Availability** | 99.9% (Stellar network) | Dependent on Stellar network uptime |

**Recovery Strategy:**
- Contracts cannot be "recovered" as they are immutable
- In case of critical bug: Deploy new contract version and migrate users
- Estimated migration time: 4-8 hours (manual process)

**Backup Strategy:**
- Contract source code in git (multiple copies)
- Deployed contract addresses documented
- Contract state is on Stellar blockchain (no backup needed)

---

### 2. Backend API

| Metric | Target | Justification |
|--------|--------|---------------|
| **RTO** | 30 minutes | Critical for user transactions and monitoring |
| **RPO** | 5 minutes | Acceptable data loss for non-financial data |
| **Availability** | 99.5% | ~3.6 hours downtime per month acceptable |

**Recovery Strategy:**
- Automated deployment from git
- Blue-green deployment for zero-downtime updates
- Health checks and automatic failover

**Backup Strategy:**
- Source code in git (GitHub)
- Docker images in container registry
- Configuration in environment variables (backed up separately)
- Deployment scripts version controlled

**Monitoring:**
- Health endpoint checks every 30 seconds
- Alert on 3 consecutive failures
- PagerDuty escalation after 5 minutes

---

### 3. Database (PostgreSQL)

| Metric | Target | Justification |
|--------|--------|---------------|
| **RTO** | 1 hour | Time to restore from backup and verify integrity |
| **RPO** | 15 minutes | Maximum acceptable data loss |
| **Availability** | 99.9% | Critical for application functionality |

**Recovery Strategy:**
- Automated backup every 15 minutes
- Point-in-time recovery (PITR) enabled
- Automated restore scripts
- Read replicas for high availability

**Backup Strategy:**
- Continuous WAL archiving (PostgreSQL)
- Full backup daily at 02:00 UTC
- Incremental backups every 15 minutes
- Backups retained for 30 days
- Backups stored in 3 locations:
  1. Primary backup server (same region)
  2. Secondary backup server (different region)
  3. Cold storage (S3/equivalent)

**Data Priority:**
1. **Critical** (RPO: 5 min): Transaction records, user balances
2. **High** (RPO: 15 min): Audit logs, referral data
3. **Medium** (RPO: 1 hour): Analytics data, cached vault state
4. **Low** (RPO: 24 hours): Session data, temporary caches

---

### 4. Frontend (Static Assets)

| Metric | Target | Justification |
|--------|--------|---------------|
| **RTO** | 15 minutes | Quick redeployment from CDN or backup |
| **RPO** | N/A | Stateless; no data to lose |
| **Availability** | 99.9% | CDN provides high availability |

**Recovery Strategy:**
- Redeploy from git repository
- CDN cache invalidation
- Multiple CDN regions for redundancy

**Backup Strategy:**
- Source code in git
- Built artifacts in artifact repository
- CDN automatically caches and distributes

---

### 5. External Dependencies

#### Stellar RPC Nodes

| Metric | Target | Justification |
|--------|--------|---------------|
| **RTO** | 5 minutes | Switch to backup RPC node |
| **RPO** | N/A | Blockchain data is distributed |
| **Availability** | 99.9% | Multiple RPC providers available |

**Recovery Strategy:**
- Primary RPC: Stellar Foundation public RPC
- Backup RPC 1: Custom hosted node
- Backup RPC 2: Third-party provider (e.g., Ankr, QuickNode)
- Automatic failover on RPC failure

#### Email Service (Resend)

| Metric | Target | Justification |
|--------|--------|---------------|
| **RTO** | 1 hour | Non-critical; can queue emails |
| **RPO** | N/A | Email delivery is best-effort |
| **Availability** | 99.5% | Acceptable for notifications |

**Recovery Strategy:**
- Queue failed emails for retry
- Switch to backup provider if primary fails
- Manual intervention for critical notifications

---

## Overall System Targets

### Production Environment

| Metric | Target | Current Status |
|--------|--------|----------------|
| **Overall RTO** | 1 hour | ⚠️ Not yet tested |
| **Overall RPO** | 15 minutes | ⚠️ Not yet tested |
| **Availability** | 99.5% | ⚠️ Not yet measured |
| **MTTR** (Mean Time To Repair) | 30 minutes | ⚠️ Not yet measured |
| **MTBF** (Mean Time Between Failures) | 720 hours (30 days) | ⚠️ Not yet measured |

### Development/Staging Environment

| Metric | Target | Notes |
|--------|--------|-------|
| **RTO** | 4 hours | Lower priority than production |
| **RPO** | 24 hours | Daily backups sufficient |
| **Availability** | 95% | Acceptable for non-production |

---

## Disaster Scenarios & Recovery Times

### Scenario 1: Database Corruption

| Phase | Time | Action |
|-------|------|--------|
| Detection | 0-5 min | Automated monitoring alerts |
| Assessment | 5-10 min | Verify corruption extent |
| Decision | 10-15 min | Decide on restore strategy |
| Restore | 15-45 min | Restore from latest backup |
| Verification | 45-60 min | Verify data integrity |
| **Total RTO** | **60 minutes** | Within target |

**Data Loss:** 0-15 minutes (last backup to failure)  
**RPO Met:** ✅ Yes (15 min target)

---

### Scenario 2: Backend API Failure

| Phase | Time | Action |
|-------|------|--------|
| Detection | 0-2 min | Health check failure |
| Assessment | 2-5 min | Check logs and metrics |
| Decision | 5-10 min | Decide on restart vs redeploy |
| Recovery | 10-20 min | Redeploy from last known good |
| Verification | 20-30 min | Smoke tests and monitoring |
| **Total RTO** | **30 minutes** | Within target |

**Data Loss:** None (stateless application)  
**RPO Met:** ✅ N/A

---

### Scenario 3: Stellar RPC Node Failure

| Phase | Time | Action |
|-------|------|--------|
| Detection | 0-1 min | RPC health check failure |
| Failover | 1-3 min | Automatic switch to backup RPC |
| Verification | 3-5 min | Verify connectivity |
| **Total RTO** | **5 minutes** | Within target |

**Data Loss:** None (blockchain data is distributed)  
**RPO Met:** ✅ N/A

---

### Scenario 4: Complete Infrastructure Failure

| Phase | Time | Action |
|-------|------|--------|
| Detection | 0-5 min | Multiple system alerts |
| Assessment | 5-15 min | Determine failure scope |
| Decision | 15-30 min | Activate DR plan |
| Infrastructure | 30-90 min | Provision new infrastructure |
| Database Restore | 90-150 min | Restore from backup |
| Backend Deploy | 150-180 min | Deploy backend services |
| Frontend Deploy | 180-195 min | Deploy frontend |
| Verification | 195-240 min | End-to-end testing |
| **Total RTO** | **4 hours** | Exceeds 1-hour target ⚠️ |

**Data Loss:** 0-15 minutes  
**RPO Met:** ✅ Yes (15 min target)

**Mitigation:**
- Pre-provision standby infrastructure (reduces RTO to 1.5 hours)
- Implement multi-region deployment (reduces RTO to 30 minutes)
- Cost: ~$500-1000/month additional

---

## Backup Schedule

### Database Backups

| Type | Frequency | Retention | Storage Location |
|------|-----------|-----------|------------------|
| Full Backup | Daily (02:00 UTC) | 30 days | Primary + S3 |
| Incremental | Every 15 minutes | 7 days | Primary |
| WAL Archive | Continuous | 7 days | Primary + S3 |
| Snapshot | Before major changes | 90 days | S3 |

### Application Backups

| Type | Frequency | Retention | Storage Location |
|------|-----------|-----------|------------------|
| Source Code | On commit | Indefinite | GitHub |
| Docker Images | On build | 30 days | Container Registry |
| Configuration | On change | 90 days | Git + Secrets Manager |
| Logs | Continuous | 30 days | Log aggregation service |

---

## Testing & Validation

### Backup Testing Schedule

| Test Type | Frequency | Last Tested | Next Test |
|-----------|-----------|-------------|-----------|
| Database Restore | Monthly | ⚠️ Never | TBD |
| Backend Redeploy | Weekly | ⚠️ Never | TBD |
| RPC Failover | Monthly | ⚠️ Never | TBD |
| Full DR Exercise | Quarterly | ⚠️ Never | TBD |
| Tabletop Exercise | Quarterly | ⚠️ Never | TBD |

### Validation Criteria

**Database Restore:**
- [ ] Restore completes within RTO
- [ ] Data integrity verified (checksums match)
- [ ] Application connects successfully
- [ ] Sample queries return expected results
- [ ] No data loss beyond RPO

**Backend Redeploy:**
- [ ] Deployment completes within RTO
- [ ] All health checks pass
- [ ] API endpoints respond correctly
- [ ] External integrations work
- [ ] No configuration errors

**Full DR Exercise:**
- [ ] All components restored within RTO
- [ ] End-to-end user flows work
- [ ] Data loss within RPO
- [ ] Monitoring and alerts functional
- [ ] Documentation accurate and complete

---

## Cost Analysis

### Current Backup Costs (Estimated)

| Item | Monthly Cost | Annual Cost |
|------|--------------|-------------|
| Database Backups (Storage) | $50 | $600 |
| WAL Archive Storage | $30 | $360 |
| Backup Bandwidth | $20 | $240 |
| Monitoring & Alerts | $100 | $1,200 |
| **Total Current** | **$200** | **$2,400** |

### Enhanced DR Costs (Recommended)

| Item | Monthly Cost | Annual Cost |
|------|--------------|-------------|
| Current Costs | $200 | $2,400 |
| Standby Infrastructure | $500 | $6,000 |
| Multi-region Replication | $300 | $3,600 |
| Enhanced Monitoring | $100 | $1,200 |
| DR Testing Environment | $200 | $2,400 |
| **Total Enhanced** | **$1,300** | **$15,600** |

**ROI Analysis:**
- Current RTO: 4 hours (complete failure)
- Enhanced RTO: 30 minutes (complete failure)
- Downtime cost: ~$10,000/hour (estimated)
- Break-even: 1.5 incidents per year

---

## Compliance & Audit

### Regulatory Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Data backup policy documented | ✅ | This document |
| Backup testing performed | ⚠️ Pending | Test results needed |
| RTO/RPO defined | ✅ | This document |
| DR plan approved | ⚠️ Pending | Signature needed |
| Annual DR test | ⚠️ Pending | Schedule needed |

### Audit Trail

| Date | Event | Performed By | Result |
|------|-------|--------------|--------|
| 2026-04-29 | Initial RTO/RPO definition | DevOps Team | Document created |
| TBD | First backup test | TBD | Pending |
| TBD | First DR exercise | TBD | Pending |
| TBD | Team lead approval | TBD | Pending |

---

## Approval & Sign-Off

### Required Approvals

- [ ] **Team Lead:** _________________________ Date: _______
- [ ] **DevOps Lead:** _________________________ Date: _______
- [ ] **Security Lead:** _________________________ Date: _______
- [ ] **Product Owner:** _________________________ Date: _______

### Review Schedule

- **Next Review:** July 29, 2026 (3 months)
- **Annual Review:** April 29, 2027
- **Trigger for Review:**
  - Major infrastructure changes
  - After any disaster recovery event
  - Significant changes to RTO/RPO requirements
  - Failed DR test

---

## Action Items

### Immediate (Within 1 Week)

- [ ] Obtain team lead approval on RTO/RPO targets
- [ ] Schedule first backup restore test
- [ ] Document current backup procedures
- [ ] Set up automated backup monitoring

### Short-term (Within 1 Month)

- [ ] Perform first database restore test
- [ ] Perform first backend redeploy test
- [ ] Perform first RPC failover test
- [ ] Document test results and update runbooks

### Medium-term (Within 3 Months)

- [ ] Conduct first tabletop DR exercise
- [ ] Implement automated backup testing
- [ ] Set up multi-region backup storage
- [ ] Establish DR testing schedule

### Long-term (Within 6 Months)

- [ ] Conduct first full DR exercise
- [ ] Evaluate multi-region deployment
- [ ] Implement automated failover
- [ ] Review and optimize costs

---

## References

- [Database Restore Runbook](./DATABASE_RESTORE.md)
- [Backend Redeployment Runbook](./BACKEND_REDEPLOY.md)
- [RPC Failover Runbook](./RPC_FAILOVER.md)
- [Full Disaster Recovery Runbook](./FULL_DR_PROCEDURE.md)
- [Environment Setup Guide](../../ENVIRONMENT_SETUP_GUIDE.md)

---

**Document Control:**
- **Version:** 1.0
- **Status:** Draft - Pending Approval
- **Classification:** Internal Use Only
- **Distribution:** DevOps, Engineering, Management
