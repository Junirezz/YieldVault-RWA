# Dead-Letter Queue (DLQ) Processing System

This document describes the production-hardened Dead-Letter Queue (DLQ) mechanism for failed asynchronous background jobs in the YieldVault RWA backend.

---

## 1. Architecture Overview

Asynchronous background jobs (such as price refreshes, position reconciliations, report exports, database backups, and APY snapshots) execute according to configured retry and backoff policies in `jobGovernance.ts`.

When job execution attempts exhaust their policy maximums (`maxAttempts`), the system captures a **Dead-Letter Record** containing the failure payload, error message, and execution metadata, preventing silent job failures and enabling administrative inspection and replay.

Dead-letter records are:
- **Persisted to the database** (`JobDeadLetter` table) for durability across restarts
- **Monitored via admin dashboard** at `/admin/jobs/dashboard`
- **Managed through REST API** endpoints requiring API key authentication
- **Audited and tracked** with immutable failure history

```
+------------------+         Retry Exhausted          +-----------------------+
|  Async Job Task  |  ----------------------------->  |   JobGovernanceStore  |
|  (runJobWithRetry)                                  |   Record Dead-Letter  |
+------------------+                                  +-----------------------+
                                                                  |
                                                    ┌─────────────┴────────────┐
                                                    v                          v
                                        +------------------+    +----------------------------+
                                        | In-Memory Store  |    | Database (JobDeadLetter)   |
                                        | (live queries)   |    | (persistence & durability) |
                                        +------------------+    +----------------------------+
                                                    |                          |
                                                    └─────────────┬────────────┘
                                                                  v
+---------------------------------------------------------------------------------+
|                              Dead-Letter Queue                                  |
|   Status: 'dead-letter' | 'processing' | 'requeued' | 'resolved' | 'discarded'  |
+---------------------------------------------------------------------------------+
          |                                   |                              |
          v                                   v                              v
+-------------------+               +-------------------+          +-------------------+
|  Retry / Requeue  |               |  Manual Resolve   |          |  Discard Record   |
| (Single/Bulk/Proc)|               | (Notes & Audited) |          | (Single / Bulk)   |
+-------------------+               +-------------------+          +-------------------+
```

---

## 2. Job Policies & Dead-Letter Thresholds

Each background job type is configured with explicit governance parameters in `JOB_POLICIES`:

| Job Name | Max Attempts | Base Delay | Backoff Multiplier | DLQ Alert Threshold |
| :--- | :--- | :--- | :--- | :--- |
| `priceRefresh` | 3 | 1,000 ms | 2x | 3 failures |
| `positionReconciliation` | 4 | 2,000 ms | 2x | 2 failures |
| `reportGeneration` | 5 | 5,000 ms | 2x | 2 failures |
| `databaseBackup` | 3 | 10,000 ms | 2x | 2 failures |
| `apySnapshot` | 3 | 1,000 ms | 2x | 3 failures |

---

## 3. Database Schema

Dead-letter records are persisted to the `JobDeadLetter` table in SQLite/PostgreSQL:

```sql
CREATE TABLE "JobDeadLetter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobName" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "payload" TEXT,  -- JSON stringified
    "failedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dead-letter',
    "retriedAt" DATETIME,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Indexes for efficient querying
CREATE INDEX "JobDeadLetter_jobName_idx" ON "JobDeadLetter"("jobName");
CREATE INDEX "JobDeadLetter_status_idx" ON "JobDeadLetter"("status");
CREATE INDEX "JobDeadLetter_createdAt_idx" ON "JobDeadLetter"("createdAt");
CREATE INDEX "JobDeadLetter_failedAt_idx" ON "JobDeadLetter"("failedAt");
CREATE INDEX "JobDeadLetter_jobName_status_idx" ON "JobDeadLetter"("jobName", "status");
```

### Persistence Guarantees

- Records are persisted **asynchronously** (fire-and-forget) to avoid blocking job execution
- Records survive **process restarts** and are reloaded into memory at startup
- Records are **visible across multiple backend instances** in multi-pod deployments
- Database failures during persistence do **not** cause job failures (logged as warnings)

### Application Lifecycle

1. **At Startup**: `initializeJobGovernance()` loads all active dead-letter records from the database
2. **During Execution**: Failed jobs are recorded both in-memory and asynchronously persisted
3. **During Operations**: Admin endpoints query both in-memory and database records for durability
4. **At Shutdown**: All pending records remain in the database for recovery

---

## 4. Admin Monitoring Dashboard

Access the interactive dashboard at **`GET /admin/jobs/dashboard`** (requires API key auth):

### Dashboard Features

- **Real-time health status** (up/degraded) with color-coded indicators
- **Summary metrics**: total dead-letters, webhook failures, recurring failures
- **Job runtime table**: shows all job types with run counts, success/fail rates, durations
- **Recent dead-letter records**: clickable list of latest failures with direct links to retry/resolve
- **API reference section**: quick links to all DLQ management endpoints
- **Full metrics JSON**: expandable details for deep inspection
- **Responsive design**: works on desktop, tablet, and mobile

Example access:
```bash
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  https://api.yieldvault.example.com/admin/jobs/dashboard
```

---

## 5. Dead-Letter Record Structure

Each dead-letter record tracks the complete execution lifecycle:

```typescript
export interface DeadLetterRecord {
  id: string;                                   // Unique ID (e.g., dlq_1719234_a1b2c3d4)
  jobName: JobName;                            // Job type identifier
  attempts: number;                            // Total failed attempts before DLQ
  error: string;                               // Normalized error message
  payload: unknown;                            // Original task payload
  failedAt: string;                            // ISO 8601 timestamp of failure
  status: 'dead-letter' | 'processing' |       // Current queue status
          'requeued' | 'resolved' | 'discarded';
  retriedAt?: string;                          // Timestamp of last retry attempt
  resolvedAt?: string;                         // Timestamp of resolution
  resolvedBy?: string;                         // Admin wallet/ID who resolved
  notes?: string;                              // Operator notes / audit trail
}
```

### Status Lifecycle

```
dead-letter ──retry──> processing ──success──> requeued
                            │
                            └──failure──> dead-letter (retry available)

dead-letter ──manual──> resolved (issue fixed externally)

dead-letter ──discard──> discarded (acknowledged, no action)
```

---

## 6. Admin Management REST API

## 6. Admin Management REST API

All DLQ management routes require API Key authentication (`validateApiKey`) and log immutable audit trail events.

### Endpoints Overview

#### 1. List Dead Letters (with Filtering & Pagination)
- **GET** `/admin/jobs/dead-letters`
- **Query Params**:
  - `jobName`: Filter by job type (e.g. `priceRefresh`, `databaseBackup`)
  - `status`: Filter by status (`dead-letter`, `requeued`, `resolved`, `discarded`)
  - `limit`: Number of records (default 50, max 500)
  - `offset`: Pagination offset (default 0)
- **Response**: 
  ```json
  {
    "data": [DeadLetterRecord, ...],
    "total": 42,
    "limit": 50,
    "offset": 0,
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Example**:
  ```bash
  curl -H "Authorization: ApiKey YOUR_KEY" \
    'https://api.example.com/admin/jobs/dead-letters?jobName=priceRefresh&status=dead-letter&limit=10'
  ```

#### 2. Get Single Dead Letter
- **GET** `/admin/jobs/dead-letters/:id`
- **Response**: 
  ```json
  {
    "record": DeadLetterRecord,
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Error** (404): Record not found

#### 3. Retry Single Dead Letter
- **POST** `/admin/jobs/dead-letters/:id/retry`
- **Query Params**: `?dryRun=true` (optional preview without execution)
- **Response** (on success):
  ```json
  {
    "message": "Dead-letter record retried successfully",
    "result": { "refreshed": true },
    "record": DeadLetterRecord,
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Response** (dry-run):
  ```json
  {
    "dryRun": true,
    "message": "Dead-letter record 'dlq_...' (priceRefresh) would be retried",
    "record": DeadLetterRecord,
    "wouldRetry": true,
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Audit logged as**: `jobs.dlq.retry`

#### 4. Resolve Dead Letter (Manual Fix)
- **POST** `/admin/jobs/dead-letters/:id/resolve`
- **Body**: 
  ```json
  {
    "notes": "Optional operator resolution explanation"
  }
  ```
- **Response**:
  ```json
  {
    "message": "Dead-letter record resolved successfully",
    "record": {
      ...DeadLetterRecord,
      "status": "resolved",
      "resolvedAt": "2026-07-29T12:34:56.000Z",
      "resolvedBy": "operator-wallet",
      "notes": "Fixed S3 bucket permissions"
    },
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Audit logged as**: `jobs.dlq.resolve`

#### 5. Discard Dead Letter
- **DELETE** `/admin/jobs/dead-letters/:id`
- **Query Params**: `?dryRun=true` (optional preview)
- **Response** (on success):
  ```json
  {
    "message": "Dead-letter record discarded successfully",
    "record": { ...DeadLetterRecord, "status": "discarded" },
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Audit logged as**: `jobs.dlq.discard`

#### 6. Bulk Retry Dead Letters
- **POST** `/admin/jobs/dead-letters/bulk-retry`
- **Body**: 
  ```json
  {
    "ids": ["dlq_1", "dlq_2", "dlq_3"]
  }
  ```
- **Response**:
  ```json
  {
    "message": "Bulk retry completed",
    "retried": 2,
    "failed": 1,
    "results": [
      { "id": "dlq_1", "success": true },
      { "id": "dlq_2", "success": true },
      { "id": "dlq_3", "success": false, "error": "Handler not found" }
    ],
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Audit logged as**: `jobs.dlq.bulk_retry`

#### 7. Bulk Discard Dead Letters
- **POST** `/admin/jobs/dead-letters/bulk-discard`
- **Body**: 
  ```json
  {
    "ids": ["dlq_1", "dlq_2"]
  }
  ```
- **Response**:
  ```json
  {
    "message": "Bulk discard completed",
    "discardedCount": 2,
    "ids": ["dlq_1", "dlq_2"],
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Audit logged as**: `jobs.dlq.bulk_discard`

#### 8. Run DLQ Batch Processor Worker
- **POST** `/admin/jobs/dead-letters/process`
- **Body**: 
  ```json
  {
    "batchSize": 10
  }
  ```
- **Response**:
  ```json
  {
    "message": "DLQ queue processing batch completed",
    "batchSize": 10,
    "processed": 8,
    "succeeded": 7,
    "failed": 1,
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```
- **Audit logged as**: `jobs.dlq.process`

#### 9. Get Job Metrics (Health & Status)
- **GET** `/admin/jobs/metrics`
- **Response**:
  ```json
  {
    "summary": {
      "health": "degraded",
      "totalDeadLetters": 5,
      "recurringFailureJobs": ["priceRefresh"],
      "activeJobs": 2
    },
    "metrics": {
      "totalDeadLetters": 5,
      "failureCounts": { "priceRefresh": 5, "apySnapshot": 2 },
      "recurringFailures": { "priceRefresh": 5 },
      "deadLetters": [...DeadLetterRecord[]],
      "policies": { ...JOB_POLICIES },
      "runtime": { ...JobRuntimeMetric[] }
    },
    "timestamp": "2026-07-29T12:34:56.000Z"
  }
  ```

---

## 7. Operator Runbook


### 7.1 Quick Start

#### Step 1: Access the Dashboard
```bash
# Open in browser or fetch HTML
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  https://api.yieldvault.example.com/admin/jobs/dashboard
```

#### Step 2: Check System Health
```bash
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  https://api.yieldvault.example.com/admin/jobs/metrics
```

If `health === "degraded"`, you have recurring failures. Proceed to Step 3.

#### Step 3: List Pending Dead-Letters
```bash
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  'https://api.yieldvault.example.com/admin/jobs/dead-letters?status=dead-letter&limit=20'
```

Review the error messages and identify root causes.

### 7.2 Common Scenarios

#### Scenario A: Temporary Outage (e.g., Database Connection Issue)

**Problem**: Multiple job failures with transient error (e.g., "ECONNREFUSED", "timeout").

**Solution**:
1. Identify the root cause (check database logs, network connectivity, rate limits)
2. Fix the issue (restart service, clear rate limit, reboot database)
3. Wait 30 seconds for stability
4. Trigger batch processing:
   ```bash
   curl -X POST \
     -H "Authorization: ApiKey YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"batchSize": 20}' \
     https://api.yieldvault.example.com/admin/jobs/dead-letters/process
   ```
5. Monitor the response — if `succeeded > 0`, jobs are recovering

#### Scenario B: Persistent Bug (e.g., Invalid API Response)

**Problem**: Job failures with consistent logic error (e.g., "undefined property X", "invalid JSON").

**Solution**:
1. Identify the code/data issue
2. Deploy a fix or update configuration
3. **Option A: Retry immediately**
   ```bash
   # Get the first failing record ID
   curl -H "Authorization: ApiKey YOUR_API_KEY" \
     'https://api.yieldvault.example.com/admin/jobs/dead-letters?status=dead-letter&limit=1' \
     | jq '.data[0].id'
   
   # Retry it (with dry-run first)
   curl -X POST \
     -H "Authorization: ApiKey YOUR_API_KEY" \
     'https://api.yieldvault.example.com/admin/jobs/dead-letters/ID/retry?dryRun=true'
   
   # If dry-run looks good, remove ?dryRun=true and execute
   curl -X POST \
     -H "Authorization: ApiKey YOUR_API_KEY" \
     'https://api.yieldvault.example.com/admin/jobs/dead-letters/ID/retry'
   ```
4. **Option B: Bulk retry all pending**
   ```bash
   # Get all pending IDs
   IDS=$(curl -H "Authorization: ApiKey YOUR_API_KEY" \
     'https://api.yieldvault.example.com/admin/jobs/dead-letters?status=dead-letter&limit=100' \
     | jq '[.data[].id]')
   
   # Bulk retry
   curl -X POST \
     -H "Authorization: ApiKey YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"ids\": $IDS}" \
     https://api.yieldvault.example.com/admin/jobs/dead-letters/bulk-retry
   ```

#### Scenario C: Manual Resolution (Issue Fixed Outside the System)

**Problem**: Job failed due to external dependency, but you fixed it manually (e.g., uploaded file, corrected data).

**Solution**:
```bash
curl -X POST \
  -H "Authorization: ApiKey YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"notes": "S3 bucket permissions updated manually by ops team"}' \
  https://api.yieldvault.example.com/admin/jobs/dead-letters/ID/resolve
```

The record is marked as resolved with audit trail. No retry needed.

#### Scenario D: Discard Non-Critical Failure

**Problem**: Job failed but is no longer relevant (e.g., old batch export, outdated price check).

**Solution**:
```bash
# Discard a single record
curl -X DELETE \
  -H "Authorization: ApiKey YOUR_API_KEY" \
  'https://api.yieldvault.example.com/admin/jobs/dead-letters/ID'

# Or bulk discard
curl -X POST \
  -H "Authorization: ApiKey YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["dlq_1", "dlq_2", "dlq_3"]}' \
  https://api.yieldvault.example.com/admin/jobs/dead-letters/bulk-discard
```

The record is removed from the queue with status set to "discarded".

### 7.3 Monitoring & Alerting

#### Key Metrics to Watch
- **`totalDeadLetters`**: Should trend toward 0
- **`recurringFailures`**: If any job appears, alert immediately
- **`health`**: If "degraded", investigate within minutes
- **Job success rate**: Monitor `successfulRuns / totalRuns` for each job

#### Alert Configuration Examples

**Alert: Multiple Failures for Single Job**
```yaml
alert:
  condition: recurring_failures[jobName] >= 3
  severity: warning
  message: "Job {jobName} has {count} recurring failures"
```

**Alert: System Degraded**
```yaml
alert:
  condition: health == "degraded"
  severity: critical
  message: "Background job system degraded - check /admin/jobs/metrics"
```

**Alert: DLQ Backlog Growing**
```yaml
alert:
  condition: totalDeadLetters > 50
  severity: warning
  message: "Dead-letter queue has {count} pending records"
```

### 7.4 Troubleshooting FAQ

**Q: I retried a record but it still failed. What now?**
A: The underlying issue persists. Check the new error message returned. If identical → root cause not resolved.

**Q: How do I know if a bulk retry succeeded?**
A: Check the response `results` array. Each entry shows `success: true/false`.

**Q: Can I retry a record multiple times?**
A: Yes. The system tracks all retry attempts in `retriedAt` and `notes` fields.

**Q: Do resolved/discarded records ever retry automatically?**
A: No. Only records with `status: 'dead-letter'` are eligible for retry.

**Q: What if the API endpoint returns 401 Unauthorized?**
A: Your API key is invalid or revoked. Check key expiration and permissions.

**Q: How do I purge old dead-letter records?**
A: Use the database directly (backup first!):
```sql
DELETE FROM "JobDeadLetter" 
  WHERE status IN ('discarded', 'resolved') 
    AND "updatedAt" < datetime('now', '-30 days');
```

### 7.5 Performance Considerations

- **Pagination**: Always use `limit` and `offset` for large queries (>100 records)
- **Bulk operations**: Limit bulk requests to ~100 IDs per request to avoid timeouts
- **Batch processor**: Default batch size is 10; safe to increase to 50 if throughput needed
- **Database indexes**: Ensure indexes on `(jobName, status)` and `createdAt` exist

---

## 8. Production Deployment Checklist

- [ ] Database migration applied (`20260729000000_add_job_dead_letter`)
- [ ] `JobDeadLetter` table exists with all indexes
- [ ] `initializeJobGovernance()` called at app startup
- [ ] API key roles include `JOBS_WRITE` permission for operators
- [ ] Monitoring alerts configured for `health == "degraded"` and `totalDeadLetters > 50`
- [ ] Team trained on common scenarios (A/B/C/D above)
- [ ] Dashboard tested (`/admin/jobs/dashboard` loads without auth errors)
- [ ] Batch processor tested with `?dryRun=true` first
- [ ] Database backup scheduled before deployment
