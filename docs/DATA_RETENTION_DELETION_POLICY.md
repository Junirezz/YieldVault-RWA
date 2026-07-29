# Data Retention & Deletion Policy

**Last Updated:** July 29, 2026
**Maintained By:** DevOps Team
**Next Review:** September 26, 2026

---

## Purpose

This document defines the data retention periods, deletion workflows, and compliance considerations for all application data stored and processed by the YieldVault-RWA platform. It serves as a reference for engineering, operations, and compliance teams to ensure data is managed in accordance with regulatory requirements (GDPR, SOC 2, ISO 27001) and operational best practices.

---

## Data Classification & Retention Schedule

### 1. Application Database (PostgreSQL)

| Data Category | Models | Retention Period | Rationale | Deletion Action |
|---|---|---|---|---|
| **User Wallets** | `User` | Indefinite (until account closure) | Core application records; required for vault access | Soft-delete with 30-day grace window before hard delete |
| **Vault State** | `VaultState`, `SharePriceSnapshot` | Indefinite | Historical share price and vault state needed for audit & reporting | Archive to cold storage after 7 years |
| **Transactions** | `Transaction` | 7 years | Financial record-keeping; regulatory compliance | Hard delete after 7 years |
| **Referral Data** | `Referral`, `ReferralCode` | Indefinite (active); 3 years after last referral | Referral program integrity; tax reporting | Soft-delete; hard delete after 3-year dormancy |
| **Admin Audit Logs** | `AdminAuditLog` | 7 years | SOC 2 / ISO 27001 audit trail | Hard delete after 7 years; archive before deletion |
| **Admin Action Receipts** | `AdminActionReceipt` | 7 years | Non-repudiation & compliance | Hard delete after 7 years |
| **Admin Impersonation** | `AdminImpersonationSession`, `AdminImpersonationLedgerEntry` | 3 years | Security monitoring; insider threat investigations | Hard delete after 3 years |
| **API Key Audit** | `ApiKeyAuditEvent` | 3 years | Key usage tracking & abuse investigation | Hard delete after 3 years |
| **Tenants and API Keys** | `Tenant`, `ApiKey` | Indefinite (active); deletion subject to contract and compliance policy | Access-control records and customer isolation | Audited soft-delete; hard delete only through approved retention cleanup |
| **Critical Entity Lifecycle Audit** | `CriticalEntityAuditEvent` | 7 years | Reconstruction of tenant and credential deletion/restoration | Append-only; archive before retention cleanup |
| **Export Jobs** | `ExportJob`, `BulkExportJob` | 90 days | Operational; cleanup to reduce DB size | Hard delete after 90 days |
| **Event Processing** | `EventCursor`, `ProcessedEvent` | 30 days | Idempotency & replay; short-lived operational data | Hard delete after 30 days |
| **Webhook Endpoints** | `WebhookEndpoint` | Indefinite (active); 90 days post-deletion | Webhook configuration; soft-delete with cleanup window | Soft-delete (`deletedAt`); hard delete after 90 days |
| **Webhook Deliveries** | `WebhookDelivery` | 90 days | Delivery tracking & debugging | Hard delete after 90 days |
| **Webhook Dead Letters** | `WebhookDeadLetter` | 30 days | Failed delivery diagnostics | Hard delete after 30 days |
| **Email Queue** | `EmailQueue` | 30 days after final status | Communication delivery tracking | Hard delete after 30 days in terminal status |
| **Config Changes** | `AdminConfigChange` | 7 years | Audit trail for configuration mutations | Hard delete after 7 years |
| **Feature Flag Overrides** | `FeatureFlagOverride` | 90 days after expiry | Temporary overrides; cleanup after expiration | Hard delete 90 days post-expiry |

### 2. Redis Cache

| Data Category | Purpose | Retention | Deletion Action |
|---|---|---|---|
| **Refresh Tokens** | Session management | Until token expiry or revocation | Automatic TTL expiry; manual revoke on logout |
| **Rate Limiting Counters** | API rate limiting | 1 hour sliding window | Automatic TTL expiry |
| **Idempotency Keys** | Duplicate request prevention | 24 hours | Automatic TTL expiry |
| **Session State** | User sessions | Until session expiry (configurable, default 24h) | Automatic TTL expiry |

### 3. Blockchain / On-Chain Data (Stellar Soroban)

| Data Category | Retention | Notes |
|---|---|---|
| **Contract State** | Permanent (immutable ledger) | Cannot be deleted; controlled via contract upgrades |
| **Vault Balances** | Permanent | On-chain; governed by smart contract logic |
| **Strategy Allocations** | Permanent | On-chain; governed by smart contract logic |
| **Whitelist Entries** | Permanent | On-chain; can add/remove via contract admin functions |
| **Transaction History** | Permanent | Stellar blockchain; immutable by design |

**Compliance Note:** On-chain data cannot be physically deleted. For GDPR right-to-erasure requests, the data must be rendered unlinkable to the individual by removing off-chain references and obfuscating on-chain associations.

### 4. Logs (Structured Logging)

| Log Type | Retention | Deletion Action |
|---|---|---|
| **Application Logs** | 90 days (hot); 1 year (cold archive) | Automated rotation; archive to S3/Blob Storage |
| **Access Logs** | 1 year | Automated rotation |
| **Error Logs** | 1 year | Automated rotation |
| **Security Audit Logs** | 7 years | Immutable storage; restricted access |

### 5. Error Monitoring (Sentry)

| Data Category | Retention | Deletion Action |
|---|---|---|
| **Error Events** | 90 days | Automatic Sentry retention policy |
| **Performance Traces** | 30 days | Automatic Sentry retention policy |
| **User Context (if any)** | 90 days | Stripped of PII per Sentry privacy settings |

---

## Deletion Workflows

### 1. Automated Deletion (Cron Jobs)

The following cron jobs implement the retention schedule above:

```bash
# Daily: Clean expired event data
0 2 * * * node scripts/cleanup/expired-events.js

# Daily: Clean completed email queue entries
0 3 * * * node scripts/cleanup/email-queue.js

# Weekly: Clean old export jobs
0 4 * * 0 node scripts/cleanup/export-jobs.js

# Weekly: Clean webhook dead letters
0 5 * * 0 node scripts/cleanup/webhook-dead-letters.js

# Weekly: Clean soft-deleted webhook endpoints
0 6 * * 0 node scripts/cleanup/webhook-endpoints.js

# Weekly: Clean expired feature flag overrides
0 7 * * 0 node scripts/cleanup/feature-flags.js

# Monthly: Clean audit data beyond 3-year retention
0 8 1 * * node scripts/cleanup/audit-logs.js

# Monthly: Clean transactions beyond 7-year retention
0 9 1 * * node scripts/cleanup/transactions.js
```

### 2. User-Initiated Deletion

**Account Closure Flow:**
1. User submits account closure request via UI
2. System validates request and queues closure
3. 30-day grace period begins (allows reversal)
4. After grace period:
   - Off-chain user data is anonymized or deleted
   - On-chain wallet association records are removed from off-chain DB
   - Referral codes are deactivated
   - Active sessions are revoked
5. Confirmation sent to user

**Data Export (Right of Access):**
- Users can request a data export via admin API
- Export includes all off-chain personal data
- Response within 30 days (GDPR requirement)
- Export format: JSON or CSV

### 3. Administrator-Initiated Deletion

**Manual Cleanup Procedures:**

| Scenario | Procedure |
|---|---|
| **Bulk data cleanup** | Use admin API endpoint `DELETE /api/admin/data/cleanup` with appropriate filters |
| **Single record deletion** | Use admin dashboard or direct DB queries with peer review |
| **Emergency data removal** | Follow incident response runbook; document in `AdminActionReceipt` |

**Approval Requirements:**
- Data deletion requires minimum 2-person approval (admin + lead)
- All deletions are logged in `AdminAuditLog` and `AdminActionReceipt`
- Bulk deletions require written authorization

### 4. On-Chain Data Handling

Since blockchain data is immutable:

| Request Type | Procedure |
|---|---|
| **Right to erasure (GDPR Art. 17)** | Remove all off-chain references linking the wallet to the individual. For on-chain data, deploy a contract upgrade that obfuscates or severs the link between wallet identity and contract state. Document the steps taken in the compliance record. |
| **Right to rectification (GDPR Art. 16)** | On-chain data cannot be modified. Use contract upgrades or new deployments to correct forward-looking state. Past transaction history remains immutable. |
| **Data portability (GDPR Art. 20)** | Export all known off-chain data. For on-chain data, provide wallet addresses and relevant transaction hashes so the user can independently query the Stellar ledger. |

---

## Compliance Considerations

### GDPR (General Data Protection Regulation)

| Requirement | Implementation |
|---|---|
| **Lawful basis for processing** | Contractual necessity (vault operations); legitimate interest (security, fraud prevention) |
| **Right to be informed** | This document serves as the data retention reference; user-facing privacy notice to be maintained separately |
| **Right of access** | Data export API endpoint; response within 30 days |
| **Right to rectification** | Supported for off-chain data; on-chain data managed via contract upgrade |
| **Right to erasure** | Off-chain: hard delete after grace period. On-chain: obfuscate wallet associations |
| **Right to restrict processing** | Flagged account records; no further processing until resolution |
| **Right to data portability** | JSON/CSV export of off-chain data; on-chain data accessible via Stellar ledger |
| **Right to object** | Opt-out mechanism for non-essential processing (e.g., marketing referrals) |
| **Automated decision-making** | No fully automated decisions with legal effect; all significant actions require admin approval |

### SOC 2 Type II

| Requirement | Implementation |
|---|---|
| **CC6.1 - Logical and physical access** | Role-based access controls; admin audit logging |
| **CC6.2 - User access provisioning** | API key management with rotation; admin impersonation sessions logged |
| **CC7.2 - Monitoring of system components** | Structured logging; Sentry error tracking; alerting |
| **CC7.3 - Incident response** | Incident response runbook in `docs/runbooks/` |
| **A1.2 - Availability** | RTO 1hr / RPO 15min as defined in DR runbooks |
| **CC8.1 - Change management** | Admin config change logging; PR-based deployments |

### ISO 27001

| Requirement | Implementation |
|---|---|
| **A.8.2 - Information classification** | This document classifies data by category and retention |
| **A.12.4 - Logging and monitoring** | Admin audit logs retained for 7 years |
| **A.12.6 - Technical vulnerability management** | CI/CD security scanning (Slither, gitleaks, dependency audit) |
| **A.18.1 - Compliance with legal requirements** | Data retention aligns with financial record-keeping regulations |

---

## Data Flow Diagram

```
User Wallet Address
    │
    ├──► PostgreSQL (off-chain)
    │       ├── User profile, transactions, referrals
    │       ├── Admin audit logs, config changes
    │       ├── Webhook configurations, delivery logs
    │       └── Export jobs, feature flags
    │
    ├──► Redis (in-memory cache)
    │       ├── Refresh tokens
    │       ├── Rate limiting counters
    │       └── Idempotency keys
    │
    ├──► Stellar Blockchain (on-chain)
    │       ├── Vault balances
    │       ├── Strategy allocations
    │       └── Transaction history
    │
    └──► External Services
            ├── Sentry (error monitoring - 90 day retention)
            └── Email provider (transactional emails)
```

---

## Deletion Implementation Guidelines

Critical control-plane entities must use the audited lifecycle service described
in [Critical Entity Soft Deletion and Audit Trail](../backend/docs/CRITICAL_ENTITY_LIFECYCLE.md).
Generic Prisma hard deletes are blocked outside tests. Tenant deletion
atomically disables its API keys, and tenant restoration never restores those
credentials automatically.

### Script Location

Cleanup scripts should be placed in `scripts/cleanup/` and follow this template:

```typescript
// scripts/cleanup/template.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const result = await prisma.modelName.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  console.log(`Cleaned up ${result.count} records`);
  return result.count;
}

cleanup()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

### Verification Steps

After any deletion run:
1. Verify record count decreased as expected
2. Check downstream systems are unaffected
3. Confirm audit logs captured the deletion
4. Run data integrity checks
5. Notify stakeholders if threshold exceeded (e.g., > 10,000 records deleted)

### Rollback Plan

- Database backups are retained for 30 days
- Point-in-time recovery (PITR) available within the RPO window (15 minutes)
- Archived data can be restored from cold storage for up to 7 years

---

## Monitoring & Alerts

| Metric | Threshold | Action |
|---|---|---|
| Cleanup job failure | Any failure | PagerDuty alert; investigate within 1 hour |
| Abnormal deletion count | > 2 standard deviations from mean | Security review; investigate potential breach |
| Retention policy violations | Records exceeding retention period | Alert engineering team; manual cleanup |
| Data growth rate | > 10% month-over-month | Review retention policy; adjust if needed |

---

## Roles & Responsibilities

| Role | Responsibility |
|---|---|
| **DevOps Team** | Maintain cleanup scripts; monitor retention jobs; manage backup/archive infrastructure |
| **Backend Team** | Implement deletion APIs; maintain data export functionality |
| **Security Team** | Audit deletion logs; investigate abnormal patterns; ensure compliance |
| **Compliance Officer** | Review and update this policy; handle data subject requests; liaise with regulators |
| **Engineering Lead** | Approve bulk deletions; review policy changes |

---

## Policy Review & Updates

This policy is reviewed quarterly or when:
- New data categories are introduced
- Regulatory requirements change
- Infrastructure changes affect data storage
- A data incident occurs
- Audit findings recommend changes

---

## References

- GDPR (General Data Protection Regulation) - https://gdpr.eu/
- SOC 2 Type II - https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance/soc-2
- ISO 27001 - https://www.iso.org/isoiec-27001-information-security.html
- Stellar Blockchain Data - https://developers.stellar.org/
- [Production Security Checklist](./PRODUCTION_SECURITY_CHECKLIST.md)
- [Incident Response Runbook](./incident_response_runbook.md)
- [Disaster Recovery Runbooks](./runbooks/README.md)
- [Admin Audit Logging](../../backend/src/middleware/adminAudit.ts)
