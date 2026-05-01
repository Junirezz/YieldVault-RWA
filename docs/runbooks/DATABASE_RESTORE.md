# Database Restore Runbook

**Purpose:** Restore the YieldVault database from backup  
**RTO Target:** 1 hour  
**RPO Target:** 15 minutes  
**Last Updated:** April 29, 2026  
**Last Tested:** ⚠️ Never - Requires testing

---

## When to Use This Runbook

Use this runbook when:
- Database corruption detected
- Accidental data deletion
- Database server failure
- Data integrity issues
- Rollback required after failed migration
- Disaster recovery scenario

---

## Prerequisites

### Required Access
- [ ] SSH access to database server
- [ ] Database admin credentials
- [ ] Backup storage access (S3 or equivalent)
- [ ] PagerDuty/Slack access for notifications

### Required Tools
- [ ] `psql` (PostgreSQL client)
- [ ] `pg_restore` (PostgreSQL restore utility)
- [ ] `aws` CLI (if using S3 for backups)
- [ ] `ssh` client

### Required Information
- [ ] Database connection string
- [ ] Backup location/path
- [ ] Target restore point (timestamp)
- [ ] Incident ticket number

---

## Pre-Restore Checklist

- [ ] **Verify backup exists** for target restore point
- [ ] **Notify team** via Slack/PagerDuty
- [ ] **Create incident ticket** and document
- [ ] **Stop backend services** to prevent writes
- [ ] **Verify disk space** (need 2x database size)
- [ ] **Take snapshot** of current database (if possible)
- [ ] **Document current state** (table counts, checksums)

---

## Restore Procedure

### Step 1: Assess the Situation (5 minutes)

#### 1.1 Verify Database Status

```bash
# Check if database is accessible
psql $DATABASE_URL -c "SELECT version();"

# Check database size
psql $DATABASE_URL -c "SELECT pg_size_pretty(pg_database_size('yieldvault_prod'));"

# Check table counts (for later verification)
psql $DATABASE_URL -c "
  SELECT schemaname, tablename, n_live_tup 
  FROM pg_stat_user_tables 
  ORDER BY n_live_tup DESC;
"
```

**Expected Output:**
```
PostgreSQL 15.x on x86_64-pc-linux-gnu
```

**If database is inaccessible:**
- Proceed to Step 2 immediately
- Document error messages
- Check database server logs

#### 1.2 Identify Restore Point

```bash
# List available backups
aws s3 ls s3://yieldvault-backups/database/ --recursive | tail -20

# Or for local backups
ls -lh /var/backups/postgresql/ | tail -20
```

**Choose restore point based on:**
- Time of last known good state
- RPO requirements (15 minutes)
- Backup availability

**Document:**
```
Restore Point: 2026-04-29 14:30:00 UTC
Backup File: yieldvault_prod_20260429_1430.dump
Backup Size: 2.5 GB
```

---

### Step 2: Stop Backend Services (5 minutes)

#### 2.1 Stop Application Servers

```bash
# If using systemd
sudo systemctl stop yieldvault-backend

# If using Docker
docker stop yieldvault-backend

# If using PM2
pm2 stop yieldvault-backend

# Verify stopped
curl http://localhost:3000/health
# Should return connection refused or 503
```

#### 2.2 Verify No Active Connections

```bash
# Check active connections
psql $DATABASE_URL -c "
  SELECT pid, usename, application_name, client_addr, state
  FROM pg_stat_activity
  WHERE datname = 'yieldvault_prod'
  AND pid <> pg_backend_pid();
"

# Terminate active connections (if necessary)
psql $DATABASE_URL -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = 'yieldvault_prod'
  AND pid <> pg_backend_pid();
"
```

**Expected Output:**
```
 pid | usename | application_name | client_addr | state
-----+---------+------------------+-------------+-------
(0 rows)
```

---

### Step 3: Backup Current State (10 minutes)

**⚠️ CRITICAL:** Always backup current state before restore, even if corrupted.

#### 3.1 Create Safety Backup

```bash
# Set backup filename with timestamp
SAFETY_BACKUP="yieldvault_pre_restore_$(date +%Y%m%d_%H%M%S).dump"

# Create backup (this may fail if database is corrupted)
pg_dump $DATABASE_URL \
  --format=custom \
  --file="/var/backups/postgresql/safety/${SAFETY_BACKUP}" \
  --verbose

# If pg_dump fails, try plain SQL format
pg_dump $DATABASE_URL \
  --format=plain \
  --file="/var/backups/postgresql/safety/${SAFETY_BACKUP}.sql" \
  --verbose

# Upload to S3 for safekeeping
aws s3 cp "/var/backups/postgresql/safety/${SAFETY_BACKUP}" \
  "s3://yieldvault-backups/safety/${SAFETY_BACKUP}"
```

**If backup fails:**
- Document the error
- Proceed with restore (data may be unrecoverable anyway)
- Note in incident report

---

### Step 4: Download Backup File (10 minutes)

#### 4.1 Download from S3

```bash
# Set variables
BACKUP_FILE="yieldvault_prod_20260429_1430.dump"
LOCAL_PATH="/var/backups/postgresql/restore/${BACKUP_FILE}"

# Download backup
aws s3 cp "s3://yieldvault-backups/database/${BACKUP_FILE}" "${LOCAL_PATH}"

# Verify download
ls -lh "${LOCAL_PATH}"
md5sum "${LOCAL_PATH}"

# Compare with stored checksum
aws s3api head-object \
  --bucket yieldvault-backups \
  --key "database/${BACKUP_FILE}" \
  --query 'Metadata.md5' \
  --output text
```

**Expected Output:**
```
-rw-r--r-- 1 postgres postgres 2.5G Apr 29 14:30 yieldvault_prod_20260429_1430.dump
a1b2c3d4e5f6... /var/backups/postgresql/restore/yieldvault_prod_20260429_1430.dump
```

**If checksums don't match:**
- ⚠️ STOP - Backup may be corrupted
- Try downloading again
- Try alternate backup
- Escalate to senior engineer

---

### Step 5: Prepare Database (5 minutes)

#### 5.1 Drop Existing Database (⚠️ DESTRUCTIVE)

```bash
# Connect as superuser
psql postgres://postgres:password@localhost/postgres

# Drop database (this will fail if connections exist)
DROP DATABASE yieldvault_prod;

# If drop fails, force disconnect and try again
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'yieldvault_prod';

DROP DATABASE yieldvault_prod;

# Create fresh database
CREATE DATABASE yieldvault_prod
  WITH OWNER = yieldvault_user
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TEMPLATE = template0;

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE yieldvault_prod TO yieldvault_user;

# Exit psql
\q
```

**Expected Output:**
```
DROP DATABASE
CREATE DATABASE
GRANT
```

---

### Step 6: Restore Database (20 minutes)

#### 6.1 Perform Restore

```bash
# Set variables
BACKUP_FILE="/var/backups/postgresql/restore/yieldvault_prod_20260429_1430.dump"
DATABASE_URL="postgresql://yieldvault_user:password@localhost:5432/yieldvault_prod"

# Restore database
pg_restore \
  --dbname="${DATABASE_URL}" \
  --verbose \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --jobs=4 \
  "${BACKUP_FILE}" \
  2>&1 | tee /var/log/postgresql/restore_$(date +%Y%m%d_%H%M%S).log

# Check exit code
echo "Restore exit code: $?"
```

**Expected Output:**
```
pg_restore: creating TABLE "public.User"
pg_restore: creating TABLE "public.VaultState"
pg_restore: creating TABLE "public.Transaction"
...
pg_restore: creating INDEX "public.Transaction_timestamp_idx"
...
Restore exit code: 0
```

**Common Errors:**

**Error:** `role "yieldvault_user" does not exist`
```bash
# Create user
psql postgres -c "CREATE USER yieldvault_user WITH PASSWORD 'password';"
# Retry restore
```

**Error:** `database "yieldvault_prod" already exists`
```bash
# Use --clean flag (already in command above)
# Or manually drop database first
```

**Error:** `out of memory`
```bash
# Reduce --jobs parameter
pg_restore --jobs=2 ...
# Or restore without parallel jobs
pg_restore --jobs=1 ...
```

---

### Step 7: Verify Restore (10 minutes)

#### 7.1 Check Table Counts

```bash
# Compare table counts with pre-restore snapshot
psql $DATABASE_URL -c "
  SELECT schemaname, tablename, n_live_tup 
  FROM pg_stat_user_tables 
  ORDER BY n_live_tup DESC;
"
```

**Expected Output:**
```
 schemaname |    tablename     | n_live_tup
------------+------------------+------------
 public     | Transaction      |      15234
 public     | User             |       1523
 public     | Referral         |        342
 public     | AdminAuditLog    |       8901
 public     | VaultState       |          1
 public     | ReferralCode     |        156
```

**Verify:**
- [ ] All tables present
- [ ] Row counts reasonable (within RPO window)
- [ ] No missing tables

#### 7.2 Check Data Integrity

```bash
# Check for NULL values in critical fields
psql $DATABASE_URL -c "
  SELECT COUNT(*) as null_addresses
  FROM \"User\"
  WHERE address IS NULL;
"

# Should return 0
```

```bash
# Check transaction data
psql $DATABASE_URL -c "
  SELECT 
    type,
    COUNT(*) as count,
    SUM(CAST(amount AS NUMERIC)) as total_amount
  FROM \"Transaction\"
  GROUP BY type;
"
```

**Expected Output:**
```
   type    | count | total_amount
-----------+-------+--------------
 deposit   |  8234 |  12345678.90
 withdraw  |  7000 |  10234567.80
```

#### 7.3 Check Indexes and Constraints

```bash
# Verify indexes
psql $DATABASE_URL -c "
  SELECT schemaname, tablename, indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname;
"

# Verify foreign keys
psql $DATABASE_URL -c "
  SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY';
"
```

#### 7.4 Run Prisma Migrations (if needed)

```bash
# Check migration status
cd /app/backend
npx prisma migrate status

# If migrations are pending
npx prisma migrate deploy

# Verify schema
npx prisma validate
```

---

### Step 8: Restart Services (5 minutes)

#### 8.1 Start Backend Services

```bash
# If using systemd
sudo systemctl start yieldvault-backend

# If using Docker
docker start yieldvault-backend

# If using PM2
pm2 start yieldvault-backend

# Wait for startup
sleep 10
```

#### 8.2 Verify Service Health

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected response
{
  "status": "healthy",
  "timestamp": "2026-04-29T15:30:00.000Z",
  "checks": {
    "api": "up",
    "database": "up",
    "stellarRpc": "up"
  }
}

# Check database connectivity
curl http://localhost:3000/api/v1/vault/summary

# Should return vault data without errors
```

---

### Step 9: Smoke Tests (10 minutes)

#### 9.1 Test Critical Endpoints

```bash
# Test user lookup
curl http://localhost:3000/api/v1/user/GXXX...

# Test transaction history
curl http://localhost:3000/api/v1/transactions?limit=10

# Test vault state
curl http://localhost:3000/api/v1/vault/metrics
```

#### 9.2 Test Database Writes

```bash
# Test audit log write (admin endpoint)
curl -X POST http://localhost:3000/admin/test-write \
  -H "Authorization: ApiKey test-key" \
  -H "Content-Type: application/json"

# Verify write succeeded
psql $DATABASE_URL -c "
  SELECT * FROM \"AdminAuditLog\"
  ORDER BY \"createdAt\" DESC
  LIMIT 1;
"
```

#### 9.3 Monitor Logs

```bash
# Check application logs
tail -f /var/log/yieldvault/backend.log

# Check for errors
grep -i error /var/log/yieldvault/backend.log | tail -20

# Check database logs
tail -f /var/log/postgresql/postgresql-15-main.log
```

---

### Step 10: Post-Restore Actions (10 minutes)

#### 10.1 Update Monitoring

```bash
# Clear any false alerts
# Update status page
# Notify monitoring team
```

#### 10.2 Document Restore

Create incident report with:
- [ ] Incident start time
- [ ] Root cause
- [ ] Restore point selected
- [ ] Data loss (if any)
- [ ] Total downtime
- [ ] Lessons learned

#### 10.3 Notify Stakeholders

```bash
# Send notification via Slack
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "✅ Database restore completed successfully",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Database Restore Complete*\n• Restore Point: 2026-04-29 14:30 UTC\n• Data Loss: ~5 minutes\n• Total Downtime: 45 minutes\n• Status: All systems operational"
        }
      }
    ]
  }'
```

---

## Rollback Procedure

If restore fails or causes issues:

### Option 1: Restore from Safety Backup

```bash
# Use the safety backup created in Step 3
pg_restore --dbname=$DATABASE_URL \
  --clean --if-exists \
  /var/backups/postgresql/safety/${SAFETY_BACKUP}
```

### Option 2: Try Different Backup

```bash
# List available backups
aws s3 ls s3://yieldvault-backups/database/ | tail -50

# Select earlier backup
# Repeat restore procedure from Step 4
```

### Option 3: Restore from WAL Archive (Point-in-Time)

```bash
# This requires WAL archiving to be enabled
# Contact senior DBA for assistance
# See: https://www.postgresql.org/docs/current/continuous-archiving.html
```

---

## Troubleshooting

### Issue: Restore Takes Too Long

**Symptoms:** Restore exceeds 20-minute window

**Solutions:**
1. Increase `--jobs` parameter (more parallel workers)
2. Check disk I/O performance
3. Verify network speed (if downloading backup)
4. Consider restoring to faster storage first

### Issue: Out of Disk Space

**Symptoms:** `No space left on device`

**Solutions:**
1. Check disk space: `df -h`
2. Clean up old backups: `rm /var/backups/postgresql/old/*`
3. Clean up logs: `find /var/log -name "*.log" -mtime +7 -delete`
4. Expand disk volume (if cloud)

### Issue: Connection Refused After Restore

**Symptoms:** Backend can't connect to database

**Solutions:**
1. Check PostgreSQL is running: `systemctl status postgresql`
2. Check pg_hba.conf for connection permissions
3. Verify DATABASE_URL is correct
4. Check firewall rules
5. Restart PostgreSQL: `systemctl restart postgresql`

### Issue: Data Inconsistencies

**Symptoms:** Missing or incorrect data

**Solutions:**
1. Verify backup file integrity (checksum)
2. Check restore logs for errors
3. Try restoring from different backup
4. Run data validation queries
5. Consider point-in-time recovery from WAL

---

## Verification Checklist

After restore, verify:

- [ ] All tables present and populated
- [ ] Row counts within expected range
- [ ] No NULL values in critical fields
- [ ] Indexes and constraints intact
- [ ] Foreign key relationships valid
- [ ] Backend connects successfully
- [ ] Health checks pass
- [ ] Critical endpoints respond
- [ ] Database writes work
- [ ] No errors in logs
- [ ] Monitoring shows healthy state
- [ ] Stakeholders notified
- [ ] Incident documented

---

## Metrics to Track

Document these metrics for each restore:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Detection Time | 5 min | ___ min | ___ |
| Decision Time | 10 min | ___ min | ___ |
| Backup Download | 10 min | ___ min | ___ |
| Restore Time | 20 min | ___ min | ___ |
| Verification Time | 10 min | ___ min | ___ |
| **Total RTO** | **60 min** | **___ min** | **___** |
| Data Loss | 15 min | ___ min | ___ |
| **RPO Met** | **Yes** | **___** | **___** |

---

## Post-Incident Review

Schedule post-incident review within 48 hours:

### Questions to Answer:
1. What caused the need for restore?
2. Was the restore successful?
3. Did we meet RTO/RPO targets?
4. What went well?
5. What could be improved?
6. Do runbooks need updates?
7. Do we need additional monitoring?
8. Should we adjust RTO/RPO targets?

### Action Items:
- [ ] Update runbook with lessons learned
- [ ] Implement preventive measures
- [ ] Schedule follow-up testing
- [ ] Update monitoring/alerting
- [ ] Train team on improvements

---

## Related Runbooks

- [RTO/RPO Targets](./RTO_RPO_TARGETS.md)
- [Backend Redeployment](./BACKEND_REDEPLOY.md)
- [Full Disaster Recovery](./FULL_DR_PROCEDURE.md)

---

## Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Database Admin | TBD | TBD | TBD |
| DevOps Lead | TBD | TBD | TBD |
| On-Call Engineer | TBD | TBD | TBD |
| Team Lead | TBD | TBD | TBD |

**PagerDuty:** [Escalation Policy Link]  
**Slack Channel:** #yieldvault-incidents

---

**Last Updated:** April 29, 2026  
**Next Review:** July 29, 2026  
**Tested:** ⚠️ Never - Schedule test ASAP
