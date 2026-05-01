# Backend Redeployment Runbook

**Purpose:** Redeploy YieldVault backend API service  
**RTO Target:** 30 minutes  
**RPO Target:** N/A (stateless application)  
**Last Updated:** April 29, 2026  
**Last Tested:** ⚠️ Never - Requires testing

---

## When to Use This Runbook

Use this runbook when:
- Backend service is unresponsive
- Application errors or crashes
- Security patch deployment
- Configuration changes required
- Rollback to previous version needed
- Performance issues requiring restart

---

## Prerequisites

### Required Access
- [ ] SSH access to application servers
- [ ] Git repository access
- [ ] Docker registry access (if using containers)
- [ ] Environment variable access
- [ ] Load balancer/proxy access

### Required Tools
- [ ] `git` client
- [ ] `node` and `npm` (v20+)
- [ ] `docker` (if using containers)
- [ ] `systemctl` or process manager (PM2)
- [ ] `curl` for testing

### Required Information
- [ ] Target version/commit hash
- [ ] Environment (production/staging)
- [ ] Incident ticket number
- [ ] Rollback plan

---

## Pre-Deployment Checklist

- [ ] **Verify backup exists** (database, config)
- [ ] **Notify team** via Slack/PagerDuty
- [ ] **Create incident ticket**
- [ ] **Check current version** and document
- [ ] **Review recent changes** in git log
- [ ] **Verify health of dependencies** (database, RPC)
- [ ] **Prepare rollback plan**
- [ ] **Schedule maintenance window** (if planned)

---

## Deployment Procedure

### Step 1: Assess Current State (5 minutes)

#### 1.1 Check Service Status

```bash
# Check if service is running
systemctl status yieldvault-backend

# Or if using PM2
pm2 status yieldvault-backend

# Or if using Docker
docker ps | grep yieldvault-backend
```

**Expected Output:**
```
● yieldvault-backend.service - YieldVault Backend API
   Loaded: loaded (/etc/systemd/system/yieldvault-backend.service)
   Active: active (running) since Mon 2026-04-29 10:00:00 UTC
```

#### 1.2 Check Application Health

```bash
# Check health endpoint
curl -s http://localhost:3000/health | jq .

# Check readiness
curl -s http://localhost:3000/ready | jq .

# Check current version
curl -s http://localhost:3000/api/v1/version | jq .
```

**Document Current State:**
```
Current Version: v1.2.3
Commit Hash: abc123def456
Uptime: 5 days
Health Status: healthy
Active Connections: 45
```

#### 1.3 Check Resource Usage

```bash
# Check CPU and memory
top -b -n 1 | grep node

# Check disk space
df -h /var/log /app

# Check open files
lsof -p $(pgrep -f yieldvault-backend) | wc -l
```

---

### Step 2: Prepare for Deployment (5 minutes)

#### 2.1 Backup Current Version

```bash
# Navigate to application directory
cd /app/yieldvault-backend

# Document current commit
git rev-parse HEAD > /var/backups/yieldvault/last_deployed_commit.txt
echo "$(date -Iseconds)" >> /var/backups/yieldvault/last_deployed_commit.txt

# Backup current environment file
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Backup current node_modules (optional, for quick rollback)
tar -czf /var/backups/yieldvault/node_modules_$(date +%Y%m%d_%H%M%S).tar.gz node_modules/
```

#### 2.2 Set Maintenance Mode (Optional)

```bash
# Create maintenance flag file
touch /app/yieldvault-backend/MAINTENANCE_MODE

# Or update load balancer to show maintenance page
# (depends on your infrastructure)
```

---

### Step 3: Stop Current Service (2 minutes)

#### 3.1 Graceful Shutdown

```bash
# If using systemd
sudo systemctl stop yieldvault-backend

# If using PM2
pm2 stop yieldvault-backend

# If using Docker
docker stop yieldvault-backend

# Wait for graceful shutdown (max 30 seconds)
sleep 5
```

#### 3.2 Verify Service Stopped

```bash
# Check process is not running
ps aux | grep yieldvault-backend | grep -v grep

# Should return nothing

# Verify port is free
netstat -tuln | grep :3000

# Should return nothing
```

**If service won't stop:**
```bash
# Force kill (last resort)
pkill -9 -f yieldvault-backend

# Or for Docker
docker kill yieldvault-backend
```

---

### Step 4: Deploy New Version (10 minutes)

#### Option A: Git-Based Deployment

```bash
# Navigate to application directory
cd /app/yieldvault-backend

# Fetch latest changes
git fetch origin

# Checkout target version
# For latest: git checkout origin/main
# For specific version: git checkout v1.3.0
# For specific commit: git checkout abc123def456
git checkout origin/main

# Verify correct version
git log -1 --oneline

# Install dependencies
npm ci --production

# Build TypeScript
npm run build

# Verify build succeeded
ls -la dist/
```

**Expected Output:**
```
HEAD is now at abc123d feat: add new feature
dist/
├── index.js
├── auth.js
├── database.js
└── ...
```

#### Option B: Docker-Based Deployment

```bash
# Pull latest image
docker pull ghcr.io/yieldvault/backend:latest

# Or specific version
docker pull ghcr.io/yieldvault/backend:v1.3.0

# Verify image
docker images | grep yieldvault/backend

# Remove old container
docker rm yieldvault-backend

# Start new container
docker run -d \
  --name yieldvault-backend \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file /app/yieldvault-backend/.env \
  -v /var/log/yieldvault:/var/log/yieldvault \
  ghcr.io/yieldvault/backend:latest
```

#### Option C: Pre-built Artifact Deployment

```bash
# Download artifact from CI/CD
aws s3 cp s3://yieldvault-artifacts/backend/v1.3.0.tar.gz /tmp/

# Extract
cd /app
tar -xzf /tmp/v1.3.0.tar.gz

# Install dependencies (if not included)
cd /app/yieldvault-backend
npm ci --production
```

---

### Step 5: Update Configuration (3 minutes)

#### 5.1 Verify Environment Variables

```bash
# Check .env file exists
ls -la /app/yieldvault-backend/.env

# Verify critical variables are set
grep -E "STELLAR_RPC_URL|VAULT_CONTRACT_ID|DATABASE_URL" .env

# Validate environment
node -e "
  require('dotenv').config();
  const required = ['STELLAR_RPC_URL', 'VAULT_CONTRACT_ID', 'DATABASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('Missing:', missing);
    process.exit(1);
  }
  console.log('✓ All required variables present');
"
```

#### 5.2 Run Database Migrations (if needed)

```bash
# Check migration status
npx prisma migrate status

# Run pending migrations
npx prisma migrate deploy

# Verify schema
npx prisma validate
```

**Expected Output:**
```
Database schema is up to date!
✓ Schema is valid
```

---

### Step 6: Start New Service (2 minutes)

#### 6.1 Start Application

```bash
# If using systemd
sudo systemctl start yieldvault-backend

# If using PM2
pm2 start yieldvault-backend
pm2 save

# If using Docker (already started in Step 4)
docker logs -f yieldvault-backend
```

#### 6.2 Wait for Startup

```bash
# Wait for service to be ready
for i in {1..30}; do
  if curl -s http://localhost:3000/health > /dev/null; then
    echo "✓ Service is up!"
    break
  fi
  echo "Waiting for service... ($i/30)"
  sleep 2
done
```

---

### Step 7: Verify Deployment (5 minutes)

#### 7.1 Check Service Health

```bash
# Check health endpoint
curl -s http://localhost:3000/health | jq .

# Expected response
{
  "status": "healthy",
  "timestamp": "2026-04-29T15:30:00.000Z",
  "uptime": 5.2,
  "environment": "production",
  "checks": {
    "api": "up",
    "database": "up",
    "stellarRpc": "up"
  }
}
```

#### 7.2 Check Readiness

```bash
# Check readiness endpoint
curl -s http://localhost:3000/ready | jq .

# Expected response
{
  "ready": true,
  "timestamp": "2026-04-29T15:30:00.000Z",
  "dependencies": {
    "database": true,
    "stellarRpc": true
  }
}
```

#### 7.3 Verify Version

```bash
# Check deployed version
curl -s http://localhost:3000/api/v1/version | jq .

# Or check git commit
cd /app/yieldvault-backend
git rev-parse HEAD

# Compare with expected version
```

#### 7.4 Check Logs

```bash
# Check application logs
tail -50 /var/log/yieldvault/backend.log

# Check for errors
grep -i error /var/log/yieldvault/backend.log | tail -20

# Check for warnings
grep -i warn /var/log/yieldvault/backend.log | tail -20

# If using systemd
journalctl -u yieldvault-backend -n 50

# If using PM2
pm2 logs yieldvault-backend --lines 50

# If using Docker
docker logs yieldvault-backend --tail 50
```

**Look for:**
- ✓ "Server started on port 3000"
- ✓ "Database connected"
- ✓ "Stellar RPC connected"
- ✗ Any error messages
- ✗ Any stack traces

---

### Step 8: Smoke Tests (5 minutes)

#### 8.1 Test Critical Endpoints

```bash
# Test vault summary
curl -s http://localhost:3000/api/v1/vault/summary | jq .

# Test vault metrics
curl -s http://localhost:3000/api/v1/vault/metrics | jq .

# Test health check
curl -s http://localhost:3000/health | jq .

# Test rate limiting (should work)
for i in {1..5}; do
  curl -s http://localhost:3000/api/v1/vault/summary > /dev/null
  echo "Request $i completed"
done
```

#### 8.2 Test Database Connectivity

```bash
# Test read operation
curl -s http://localhost:3000/api/v1/transactions?limit=1 | jq .

# Test write operation (if safe)
curl -X POST http://localhost:3000/admin/test-write \
  -H "Authorization: ApiKey test-key" \
  -H "Content-Type: application/json"
```

#### 8.3 Test External Integrations

```bash
# Test Stellar RPC connectivity
curl -s http://localhost:3000/api/v1/vault/total-assets | jq .

# Test email service (if applicable)
# curl -X POST http://localhost:3000/admin/test-email ...
```

---

### Step 9: Enable Traffic (2 minutes)

#### 9.1 Remove Maintenance Mode

```bash
# Remove maintenance flag
rm -f /app/yieldvault-backend/MAINTENANCE_MODE

# Or update load balancer to enable traffic
# (depends on your infrastructure)
```

#### 9.2 Verify External Access

```bash
# Test from external IP (if different from localhost)
curl -s https://api.yieldvault.finance/health | jq .

# Test through load balancer
curl -s https://api.yieldvault.finance/api/v1/vault/summary | jq .
```

---

### Step 10: Post-Deployment (3 minutes)

#### 10.1 Monitor Metrics

```bash
# Watch logs for errors
tail -f /var/log/yieldvault/backend.log | grep -i error

# Monitor resource usage
watch -n 5 'ps aux | grep yieldvault-backend'

# Check error rate
# (depends on your monitoring setup)
```

#### 10.2 Update Documentation

```bash
# Document deployment
cat >> /var/log/yieldvault/deployments.log <<EOF
Deployment: $(date -Iseconds)
Version: $(git rev-parse HEAD)
Deployed By: $(whoami)
Incident: INCIDENT-123
Status: Success
EOF
```

#### 10.3 Notify Stakeholders

```bash
# Send notification via Slack
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "✅ Backend deployment completed successfully",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Backend Deployment Complete*\n• Version: v1.3.0\n• Downtime: 5 minutes\n• Status: All systems operational"
        }
      }
    ]
  }'
```

---

## Rollback Procedure

If deployment fails or causes issues:

### Quick Rollback (5 minutes)

```bash
# Stop current service
sudo systemctl stop yieldvault-backend

# Restore previous version
cd /app/yieldvault-backend
git checkout $(cat /var/backups/yieldvault/last_deployed_commit.txt | head -1)

# Restore environment
cp .env.backup.* .env

# Rebuild (if needed)
npm run build

# Start service
sudo systemctl start yieldvault-backend

# Verify
curl http://localhost:3000/health
```

### Docker Rollback

```bash
# Stop current container
docker stop yieldvault-backend
docker rm yieldvault-backend

# Start previous version
docker run -d \
  --name yieldvault-backend \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file /app/yieldvault-backend/.env \
  ghcr.io/yieldvault/backend:v1.2.3
```

---

## Troubleshooting

### Issue: Service Won't Start

**Symptoms:** Service fails to start or crashes immediately

**Solutions:**
1. Check logs: `journalctl -u yieldvault-backend -n 100`
2. Verify environment variables: `node -e "require('dotenv').config(); console.log(process.env)"`
3. Check port availability: `netstat -tuln | grep :3000`
4. Verify dependencies: `npm ls`
5. Check file permissions: `ls -la /app/yieldvault-backend`

### Issue: Database Connection Fails

**Symptoms:** "Cannot connect to database" errors

**Solutions:**
1. Verify DATABASE_URL: `echo $DATABASE_URL`
2. Test connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Check database is running: `systemctl status postgresql`
4. Verify network connectivity: `ping database-host`
5. Check firewall rules

### Issue: High Memory Usage

**Symptoms:** Service uses excessive memory

**Solutions:**
1. Check for memory leaks: `node --inspect`
2. Restart service: `systemctl restart yieldvault-backend`
3. Increase memory limit (if needed)
4. Review recent code changes
5. Enable heap snapshots for analysis

### Issue: Slow Response Times

**Symptoms:** API endpoints respond slowly

**Solutions:**
1. Check database performance: `EXPLAIN ANALYZE SELECT ...`
2. Check Stellar RPC latency: `curl -w "@curl-format.txt" $STELLAR_RPC_URL`
3. Review application logs for slow queries
4. Check resource usage: `top`, `iostat`
5. Enable performance profiling

---

## Verification Checklist

After deployment, verify:

- [ ] Service is running
- [ ] Health check passes
- [ ] Readiness check passes
- [ ] Correct version deployed
- [ ] No errors in logs
- [ ] Database connectivity works
- [ ] Stellar RPC connectivity works
- [ ] Critical endpoints respond
- [ ] Rate limiting works
- [ ] External access works
- [ ] Monitoring shows healthy state
- [ ] Stakeholders notified
- [ ] Deployment documented

---

## Metrics to Track

Document these metrics for each deployment:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Stop Service | 2 min | ___ min | ___ |
| Deploy Code | 10 min | ___ min | ___ |
| Start Service | 2 min | ___ min | ___ |
| Verification | 5 min | ___ min | ___ |
| **Total RTO** | **30 min** | **___ min** | **___** |
| Errors During Deploy | 0 | ___ | ___ |
| Rollback Required | No | ___ | ___ |

---

## Blue-Green Deployment (Advanced)

For zero-downtime deployments:

### Setup

```bash
# Deploy to green environment
ssh green-server
cd /app/yieldvault-backend
git pull
npm ci
npm run build

# Start green service on different port
PORT=3001 npm start

# Verify green is healthy
curl http://localhost:3001/health
```

### Switch Traffic

```bash
# Update load balancer to point to green
# (depends on your infrastructure)

# Verify traffic is flowing to green
curl https://api.yieldvault.finance/health

# Monitor for issues
# If issues, switch back to blue
```

### Cleanup

```bash
# Stop blue service
ssh blue-server
sudo systemctl stop yieldvault-backend

# Green becomes new blue for next deployment
```

---

## Related Runbooks

- [RTO/RPO Targets](./RTO_RPO_TARGETS.md)
- [Database Restore](./DATABASE_RESTORE.md)
- [RPC Failover](./RPC_FAILOVER.md)
- [Full Disaster Recovery](./FULL_DR_PROCEDURE.md)

---

## Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| DevOps Lead | TBD | TBD | TBD |
| Backend Lead | TBD | TBD | TBD |
| On-Call Engineer | TBD | TBD | TBD |
| Team Lead | TBD | TBD | TBD |

**PagerDuty:** [Escalation Policy Link]  
**Slack Channel:** #yieldvault-incidents

---

**Last Updated:** April 29, 2026  
**Next Review:** July 29, 2026  
**Tested:** ⚠️ Never - Schedule test ASAP
