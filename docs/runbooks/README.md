# Disaster Recovery Runbooks

This directory contains operational runbooks for disaster recovery and incident response for the YieldVault platform.

---

## Quick Links

| Runbook | RTO | RPO | Use When |
|---------|-----|-----|----------|
| [Incident Triage & Severity Classification](./INCIDENT_TRIAGE_AND_SEVERITY.md) | N/A | N/A | First responder triage and severity classification for any alert |
| [Incident Response & Rollback Operations](./rollback-and-hotfix.md) | 15 min | N/A | Emergency pause, incident escalation, and multi-tier rollback procedures |
| [RTO/RPO Targets](./RTO_RPO_TARGETS.md) | N/A | N/A | Understanding recovery objectives |
| [Database Restore](./DATABASE_RESTORE.md) | 1 hour | 15 min | Database corruption or failure |
| [Backend Redeploy](./BACKEND_REDEPLOY.md) | 30 min | N/A | Backend service issues |
| [Contract Upgrade & Migration](./CONTRACT_UPGRADE_PLAYBOOK.md) | N/A | N/A | Smart contract upgrade deployment and rollback |
| [RPC Failover](./RPC_FAILOVER.md) | 5 min | N/A | Stellar RPC node failure |
| [RPC Provider Failover Strategy](../RPC_PROVIDER_FAILOVER_STRATEGY.md) | N/A | N/A | Provider ordering, timeout/retry & switch configuration |
| [Failed Withdrawal Incident Playbook](./FAILED_WITHDRAWAL_INCIDENT_PLAYBOOK.md) | 30 min | N/A | Withdrawals failing / stuck / debited-not-received |
| [Full DR Procedure](./FULL_DR_PROCEDURE.md) | 4 hours | 15 min | Complete infrastructure failure |
| [Replay & State Recovery](./REPLAY_PROCEDURES.md) | N/A | N/A | Recovering/syncing ledger events or email queue |
| [Error Code Troubleshooting](./ERROR_CODE_TROUBLESHOOTING.md) | N/A | N/A | Diagnose and fix backend errors |
| [Postmortem Playbook](../postmortem-playbook.md) | N/A | N/A | Publishing incident postmortems |
| [Published Postmortems](../incidents/README.md) | N/A | N/A | Archive of finalized incident reports |

---

## Overview

### What are Runbooks?

Runbooks are step-by-step operational guides that enable any engineer to execute complex procedures consistently and reliably. They are designed to be followed during high-stress situations when quick, accurate action is critical.

### When to Use These Runbooks

- **During incidents:** Follow the appropriate runbook for the failure type
- **During testing:** Use runbooks to practice disaster recovery
- **During training:** Familiarize new team members with procedures
- **During planning:** Reference RTO/RPO targets for capacity planning

---

## Runbook Descriptions

### 1. RTO/RPO Targets

**File:** [RTO_RPO_TARGETS.md](./RTO_RPO_TARGETS.md)

**Purpose:** Defines Recovery Time Objective (RTO) and Recovery Point Objective (RPO) targets for all system components.

**Key Information:**
- Component-specific RTO/RPO targets
- Disaster scenario analysis
- Backup schedules
- Cost analysis
- Testing requirements

**When to Read:**
- Before any disaster recovery activity
- During capacity planning
- When evaluating infrastructure changes
- During compliance audits

---

### 2. Database Restore

**File:** [DATABASE_RESTORE.md](./DATABASE_RESTORE.md)

**Purpose:** Restore the YieldVault database from backup.

**RTO:** 1 hour  
**RPO:** 15 minutes

**Use Cases:**
- Database corruption
- Accidental data deletion
- Database server failure
- Rollback after failed migration
- Data integrity issues

**Prerequisites:**
- Database admin credentials
- Backup storage access
- SSH access to database server

**Key Steps:**
1. Assess situation (5 min)
2. Stop backend services (5 min)
3. Backup current state (10 min)
4. Download backup (10 min)
5. Restore database (20 min)
6. Verify restore (10 min)
7. Restart services (5 min)

---

### 3. Backend Redeployment

**File:** [BACKEND_REDEPLOY.md](./BACKEND_REDEPLOY.md)

**Purpose:** Redeploy the backend API service.

**RTO:** 30 minutes  
**RPO:** N/A (stateless)

**Use Cases:**
- Backend service unresponsive
- Application crashes
- Security patch deployment
- Configuration changes
- Performance issues

**Prerequisites:**
- Git repository access
- SSH access to servers
- Environment variables
- Docker/PM2 access

**Key Steps:**
1. Assess current state (5 min)
2. Prepare for deployment (5 min)
3. Stop service (2 min)
4. Deploy new version (10 min)
5. Start service (2 min)
6. Verify deployment (5 min)
7. Smoke tests (5 min)

---

### 4. Contract Upgrade & Migration

**File:** [CONTRACT_UPGRADE_PLAYBOOK.md](./CONTRACT_UPGRADE_PLAYBOOK.md)

**Purpose:** Safely upgrade Soroban contract code and migrate contract state when required.

**RTO:** 30 minutes  
**RPO:** N/A (on-chain data preserved by contract upgrade)

**Use Cases:**
- Contract code upgrade for YieldVault vault logic
- State migration during contract version change
- Vault pause and resume for safe upgrade
- Rollback after failed upgrade

**Prerequisites:**
- Admin access to the deployed Stellar contract
- Existing WASM hash and rollback artifact
- Verified testnet/staging upgrade run
- Monitoring and webhook validation

**Key Steps:**
1. Check current contract state and pause eligibility
2. Install new WASM and record hash
3. Pause vault and execute upgrade
4. Validate contract behaviour post-upgrade
5. Resume operations or rollback if required

---

### 5. RPC Failover

**File:** [RPC_FAILOVER.md](./RPC_FAILOVER.md)

**Purpose:** Switch to backup Stellar RPC node.

**RTO:** 5 minutes  
**RPO:** N/A (blockchain data)

**Use Cases:**
- Primary RPC node unresponsive
- RPC errors or timeouts
- Performance degradation
- Rate limiting issues
- Planned maintenance

**Prerequisites:**
- Backup RPC URLs
- Environment variable access
- SSH access to servers

**Key Steps:**
1. Verify RPC failure (2 min)
2. Select backup RPC (1 min)
3. Update configuration (1 min)
4. Restart service (1 min)
5. Verify failover (2 min)

---

### 5. Contract Upgrade & Migration

**File:** [CONTRACT_UPGRADE_PLAYBOOK.md](./CONTRACT_UPGRADE_PLAYBOOK.md)

**Purpose:** Guide smart contract code upgrades and rollback for YieldVault deployments.

**RTO:** N/A
**RPO:** N/A

**Use Cases:**
- Scheduled Vault contract upgrades
- Contract migration path verification
- In-place Soroban code rollback
- Release validation for new vault versions

**Prerequisites:**
- Deployer/admin key access
- Existing Vault contract deployment
- Previous WASM hash preserved
- Testnet upgrade completion prior to mainnet rollout

**Key Steps:**
1. Run pre-upgrade checks
2. Pause the Vault contract
3. Upload and upgrade new WASM
4. Verify the new contract version
5. Resume operations or rollback if needed

---

### 6. Full Disaster Recovery

**File:** [FULL_DR_PROCEDURE.md](./FULL_DR_PROCEDURE.md)

**Purpose:** Complete system recovery from catastrophic failure.

**RTO:** 4 hours (1.5 hours with standby infrastructure)  
**RPO:** 15 minutes

**Use Cases:**
- Data center outage
- Multiple component failures
- Complete infrastructure loss
- Natural disaster
- Cyber attack requiring rebuild

**Prerequisites:**
- Cloud provider admin access
- All backup access
- Full team availability
- Emergency budget approval

**Key Phases:**
1. Assessment & Planning (30 min)
2. Infrastructure Provisioning (60 min)
3. Database Recovery (60 min)
4. Backend Deployment (30 min)
5. Frontend Deployment (15 min)
6. External Services (15 min)
7. Verification & Testing (30 min)
8. Cutover (15 min)
9. Post-Recovery (30 min)

---

### 7. Replay & State Recovery

**File:** [REPLAY_PROCEDURES.md](./REPLAY_PROCEDURES.md)

**Purpose:** Manually replay Stellar blockchain events or requeue failed email queue jobs.

**RTO:** N/A  
**RPO:** N/A

**Use Cases:**
- Recovering missed ledger events after a database restore or sync lag
- Re-processing block ranges after bug fixes or state changes
- Manually triggering delivery of failed system/transaction emails

**Key Steps:**
1. Retrieve API credentials
2. Execute dry-run preview to verify range
3. Trigger replay endpoint with desired parameters
4. Verify success via database queries and logs

---

## Decision Tree

Use this decision tree to select the appropriate runbook:

```
Alert fires or incident reported
│
└─▶ Step 0: Classify severity using [Incident Triage & Severity Classification](./INCIDENT_TRIAGE_AND_SEVERITY.md). Then:

Is the entire infrastructure down?
├─ YES → Use Full DR Procedure
└─ NO → Continue

Is the database corrupted or inaccessible?
├─ YES → Use Database Restore
└─ NO → Continue

Is the backend service down or malfunctioning?
├─ YES → Use Backend Redeploy
└─ NO → Continue

Is the Stellar RPC node failing?
├─ YES → Use RPC Failover
└─ NO → Are you getting a specific error code from the API or contracts?
        ├─ YES → Use Error Code Troubleshooting
        └─ NO → Are ledger events lagging or email queue jobs failing?
                ├─ YES → Use Replay & State Recovery
                └─ NO → Check component-specific documentation
```

---

## Testing Requirements

### Mandatory Testing

All runbooks must be tested according to this schedule:

| Runbook | Test Frequency | Last Tested | Next Test |
|---------|----------------|-------------|-----------|
| Database Restore | Monthly | ⚠️ Never | TBD |
| Backend Redeploy | Weekly | ⚠️ Never | TBD |
| RPC Failover | Monthly | ⚠️ Never | TBD |
| Full DR Procedure | Annually | ⚠️ Never | TBD |
| Replay & State Recovery | Monthly | ⚠️ Never | TBD |
| Incident Triage & Severity | Quarterly (tabletop) | ⚠️ Never | TBD |
| Error Code Troubleshooting | Quarterly | ⚠️ Never | TBD |

### Testing Types

1. **Triage Drill** (Monthly)
   - Simulate an alert and run through the [Incident Triage & Severity Classification](./INCIDENT_TRIAGE_AND_SEVERITY.md) triage flow
   - Time the classification decision against the 15-minute target
   - Duration: 30 minutes

2. **Tabletop Exercise** (Quarterly)
   - Walk through runbook as a team
   - Identify gaps and issues
   - Update documentation
   - Duration: 2 hours

2. **Partial Test** (Monthly)
   - Execute runbook in non-production
   - Verify all steps work
   - Measure actual RTO/RPO
   - Duration: 1-4 hours

3. **Full DR Test** (Annually)
   - Execute complete DR in production-like environment
   - Involve entire team
   - Simulate real disaster
   - Duration: 8 hours

---

## Runbook Maintenance

### Update Triggers

Update runbooks when:
- Infrastructure changes
- New tools or processes adopted
- Testing reveals issues
- Actual incident occurs
- Team feedback received
- Quarterly review cycle

### Review Schedule

- **Monthly:** Quick review of recent changes
- **Quarterly:** Full review and testing
- **Annually:** Complete rewrite if needed

### Version Control

All runbooks are version controlled in git:
- Track changes over time
- Review history of updates
- Collaborate on improvements
- Maintain audit trail

---

## Incident Response Process

### 1. Detect

- Monitoring alerts
- User reports
- Health check failures
- Manual discovery

### 2. Assess

- Determine severity
- Identify affected components
- Estimate impact
- Select appropriate runbook

### 3. Respond

- Assemble team
- Create incident channel
- Follow runbook
- Document actions

### 4. Recover

- Execute recovery steps
- Verify restoration
- Monitor closely
- Notify stakeholders

### 5. Review

- Post-incident review
- Update runbooks
- Implement improvements
- Share learnings

---

## Roles & Responsibilities

### Incident Commander
- Declares disaster
- Assembles team
- Makes final decisions
- Communicates with stakeholders

### Database Administrator
- Executes database restore
- Verifies data integrity
- Manages database configuration

### DevOps Engineer
- Provisions infrastructure
- Deploys applications
- Configures networking
- Manages monitoring

### Backend Engineer
- Deploys backend code
- Verifies functionality
- Troubleshoots issues

### Frontend Engineer
- Deploys frontend code
- Verifies user experience
- Updates configuration

### Security Engineer
- Assesses security implications
- Verifies security controls
- Manages secrets and keys

---

## Communication Plan

### Internal Communication

**Slack Channels:**
- `#yieldvault-incidents` - General incident updates
- `#yieldvault-war-room` - Active incident coordination
- `#yieldvault-ops` - Operational updates

**PagerDuty:**
- Escalation policies defined
- On-call rotation maintained
- Alert routing configured

### External Communication

**Status Page:**
- Update during incidents
- Provide ETAs
- Post-incident reports

**Customer Communication:**
- Email notifications
- In-app messages
- Social media updates

---

## Tools & Resources

### Required Tools

- **SSH Client:** Access to servers
- **psql:** PostgreSQL client
- **curl:** API testing
- **jq:** JSON parsing
- **git:** Version control
- **aws/gcloud/az:** Cloud CLI tools

### Helpful Resources

- [Stellar Documentation](https://developers.stellar.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Node.js Documentation](https://nodejs.org/docs/)
- [Docker Documentation](https://docs.docker.com/)

### Monitoring Dashboards

- Health Dashboard: [Link]
- Metrics Dashboard: [Link]
- Logs Dashboard: [Link]
- Alerts Dashboard: [Link]

---

## Metrics & KPIs

### Track These Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Mean Time To Detect (MTTD) | < 5 min | TBD |
| Mean Time To Respond (MTTR) | < 30 min | TBD |
| Recovery Success Rate | > 95% | TBD |
| RTO Achievement | > 90% | TBD |
| RPO Achievement | > 95% | TBD |

### Incident Metrics

For each incident, track:
- Detection time
- Response time
- Recovery time
- Data loss
- Root cause
- Lessons learned

---

## Training

### New Team Member Onboarding

1. Read all runbooks
2. Attend tabletop exercise
3. Shadow experienced engineer
4. Execute runbook in test environment
5. Participate in on-call rotation

### Ongoing Training

- Quarterly tabletop exercises
- Monthly runbook reviews
- Annual full DR test
- Post-incident reviews

---

## Continuous Improvement

### Feedback Loop

1. **Collect Feedback**
   - After each incident
   - During testing
   - From team members

2. **Analyze**
   - What worked well?
   - What could be improved?
   - What was missing?

3. **Update**
   - Revise runbooks
   - Update procedures
   - Improve tools

4. **Test**
   - Verify improvements
   - Measure impact
   - Iterate

---

## Compliance & Audit

### Audit Requirements

- [ ] Runbooks documented
- [ ] RTO/RPO defined and approved
- [ ] Testing schedule established
- [ ] Tests performed and documented
- [ ] Incidents documented
- [ ] Improvements implemented

### Compliance Standards

- SOC 2 Type II
- ISO 27001
- GDPR (if applicable)
- Industry best practices

---

## Support

### Getting Help

1. **During Incident:**
   - Use PagerDuty escalation
   - Post in #yieldvault-war-room
   - Call emergency contacts

2. **For Runbook Questions:**
   - Post in #yieldvault-ops
   - Contact DevOps team
   - Review documentation

3. **For Updates:**
   - Submit PR to update runbook
   - Discuss in team meeting
   - Document in incident review

---

## Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Incident Commander | TBD | TBD | TBD |
| Database Admin | TBD | TBD | TBD |
| DevOps Lead | TBD | TBD | TBD |
| Backend Lead | TBD | TBD | TBD |
| Frontend Lead | TBD | TBD | TBD |
| Security Lead | TBD | TBD | TBD |
| Team Lead | TBD | TBD | TBD |
| CEO/CTO | TBD | TBD | TBD |

**PagerDuty:** [Escalation Policy Link]  
**Slack:** #yieldvault-war-room  
**Zoom:** [Emergency Meeting Link]

---

## Appendix

### A. Glossary

- **RTO:** Recovery Time Objective - Maximum acceptable downtime
- **RPO:** Recovery Point Objective - Maximum acceptable data loss
- **MTTR:** Mean Time To Repair - Average time to fix issues
- **MTBF:** Mean Time Between Failures - Average time between incidents
- **DR:** Disaster Recovery
- **HA:** High Availability

### B. Checklists

See individual runbooks for detailed checklists.

### C. Templates

- [Incident Report Template](./templates/incident-report.md)
- [Post-Mortem Template](./templates/post-mortem.md)
- [DR Test Report Template](./templates/dr-test-report.md)

---

**Last Updated:** July 26, 2026  
**Maintained By:** DevOps Team  
**Next Review:** October 26, 2026
