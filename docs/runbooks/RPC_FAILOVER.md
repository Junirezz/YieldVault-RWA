# Stellar RPC Node Failover Runbook

**Purpose:** Switch to backup Stellar RPC node  
**RTO Target:** 5 minutes  
**RPO Target:** N/A (blockchain data is distributed)  
**Last Updated:** April 29, 2026  
**Last Tested:** ⚠️ Never - Requires testing

---

## When to Use This Runbook

Use this runbook when:
- Primary Stellar RPC node is unresponsive
- RPC node returns errors or timeouts
- RPC node performance degradation
- Planned RPC node maintenance
- Network connectivity issues to primary RPC
- Rate limiting from RPC provider

---

## Prerequisites

### Required Access
- [ ] SSH access to backend servers
- [ ] Environment variable access
- [ ] Backup RPC node credentials (if needed)
- [ ] Monitoring dashboard access

### Required Tools
- [ ] `curl` for testing
- [ ] `jq` for JSON parsing
- [ ] Text editor (`nano`, `vim`)
- [ ] Process manager access (`systemctl`, `pm2`)

### Required Information
- [ ] Primary RPC URL
- [ ] Backup RPC URLs
- [ ] Network passphrase
- [ ] Incident ticket number

---

## Pre-Failover Checklist

- [ ] **Verify primary RPC is down** (not a temporary glitch)
- [ ] **Notify team** via Slack/PagerDuty
- [ ] **Create incident ticket**
- [ ] **Document current RPC URL**
- [ ] **Verify backup RPC is available**
- [ ] **Check backup RPC health**

---

## Failover Procedure

### Step 1: Verify RPC Failure (2 minutes)

#### 1.1 Test Primary RPC

```bash
# Get current RPC URL from environment
PRIMARY_RPC=$(grep STELLAR_RPC_URL /app/yieldvault-backend/.env | cut -d '=' -f2)
echo "Primary RPC: $PRIMARY_RPC"

# Test RPC health
curl -X POST "$PRIMARY_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getHealth"
  }' | jq .

# Test with timeout
timeout 5 curl -X POST "$PRIMARY_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getLatestLedger"
  }' | jq .
```

**Expected Output (Healthy):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": "healthy"
  }
}
```

**Failure Indicators:**
- Connection timeout
- Connection refused
- HTTP 5xx errors
- Rate limit errors (429)
- Slow response (>5 seconds)

#### 1.2 Check Application Logs

```bash
# Check for RPC errors in application logs
tail -100 /var/log/yieldvault/backend.log | grep -i "stellar\|rpc\|soroban"

# Look for patterns like:
# - "RPC connection failed"
# - "Timeout waiting for RPC"
# - "Rate limit exceeded"
# - "Network error"
```

#### 1.3 Verify It's Not a Network Issue

```bash
# Test network connectivity
ping -c 5 soroban-testnet.stellar.org

# Test DNS resolution
nslookup soroban-testnet.stellar.org

# Test HTTPS connectivity
curl -I https://soroban-testnet.stellar.org
```

---

### Step 2: Select Backup RPC (1 minute)

#### 2.1 Available RPC Nodes

**Testnet Options:**
1. **Stellar Foundation Public RPC** (Primary)
   - URL: `https://soroban-testnet.stellar.org`
   - Rate Limit: Moderate
   - Reliability: High

2. **Custom Hosted Node** (Backup 1)
   - URL: `https://rpc.yieldvault.finance`
   - Rate Limit: None (self-hosted)
   - Reliability: High (if maintained)

3. **Third-Party Provider** (Backup 2)
   - URL: `https://stellar-testnet.ankr.com` (example)
   - Rate Limit: Varies by plan
   - Reliability: High

**Mainnet Options:**
1. **Stellar Foundation Public RPC** (Primary)
   - URL: `https://soroban-mainnet.stellar.org`
   - Rate Limit: Moderate
   - Reliability: High

2. **QuickNode** (Backup 1)
   - URL: `https://your-endpoint.stellar-mainnet.quiknode.pro`
   - Rate Limit: Based on plan
   - Reliability: Very High

3. **Custom Hosted Node** (Backup 2)
   - URL: `https://rpc-mainnet.yieldvault.finance`
   - Rate Limit: None
   - Reliability: High (if maintained)

#### 2.2 Test Backup RPC

```bash
# Test backup RPC health
BACKUP_RPC="https://rpc.yieldvault.finance"

curl -X POST "$BACKUP_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getHealth"
  }' | jq .

# Test ledger query
curl -X POST "$BACKUP_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getLatestLedger"
  }' | jq .

# Measure response time
time curl -X POST "$BACKUP_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getLatestLedger"
  }' > /dev/null 2>&1
```

**Expected Output:**
```
real    0m0.234s  # Should be < 1 second
user    0m0.012s
sys     0m0.008s
```

**If backup RPC is also down:**
- Try next backup in list
- Consider temporary degraded service
- Escalate to senior engineer

---

### Step 3: Update Configuration (1 minute)

#### 3.1 Backup Current Configuration

```bash
# Backup current .env file
cd /app/yieldvault-backend
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Document current RPC
grep STELLAR_RPC_URL .env >> /var/log/yieldvault/rpc_changes.log
echo "Changed at: $(date -Iseconds)" >> /var/log/yieldvault/rpc_changes.log
```

#### 3.2 Update RPC URL

```bash
# Update .env file
BACKUP_RPC="https://rpc.yieldvault.finance"

# Using sed (Linux)
sed -i "s|STELLAR_RPC_URL=.*|STELLAR_RPC_URL=$BACKUP_RPC|" .env

# Or using sed (macOS)
sed -i '' "s|STELLAR_RPC_URL=.*|STELLAR_RPC_URL=$BACKUP_RPC|" .env

# Or manually edit
nano .env
# Change: STELLAR_RPC_URL=https://soroban-testnet.stellar.org
# To:     STELLAR_RPC_URL=https://rpc.yieldvault.finance

# Verify change
grep STELLAR_RPC_URL .env
```

**Expected Output:**
```
STELLAR_RPC_URL=https://rpc.yieldvault.finance
```

#### 3.3 Verify Network Passphrase (Critical!)

```bash
# Ensure network passphrase matches the RPC network
grep STELLAR_NETWORK_PASSPHRASE .env

# For testnet, should be:
# STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# For mainnet, should be:
# STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

**⚠️ CRITICAL:** Mismatched network passphrase will cause transaction failures!

---

### Step 4: Restart Backend Service (1 minute)

#### 4.1 Restart Application

```bash
# If using systemd
sudo systemctl restart yieldvault-backend

# If using PM2
pm2 restart yieldvault-backend

# If using Docker
docker restart yieldvault-backend

# Wait for startup
sleep 5
```

#### 4.2 Verify Service Started

```bash
# Check service status
systemctl status yieldvault-backend

# Or PM2
pm2 status yieldvault-backend

# Or Docker
docker ps | grep yieldvault-backend
```

---

### Step 5: Verify Failover (2 minutes)

#### 5.1 Check Application Health

```bash
# Check health endpoint
curl -s http://localhost:3000/health | jq .

# Expected response
{
  "status": "healthy",
  "checks": {
    "api": "up",
    "database": "up",
    "stellarRpc": "up"  # Should be "up"
  }
}
```

#### 5.2 Test RPC Connectivity

```bash
# Test vault contract query
curl -s http://localhost:3000/api/v1/vault/total-assets | jq .

# Test vault summary
curl -s http://localhost:3000/api/v1/vault/summary | jq .

# Should return data without errors
```

#### 5.3 Check Application Logs

```bash
# Check for successful RPC connection
tail -50 /var/log/yieldvault/backend.log | grep -i "stellar\|rpc"

# Look for:
# ✓ "Connected to Stellar RPC"
# ✓ "RPC health check passed"
# ✗ No error messages
```

#### 5.4 Test Transaction Simulation

```bash
# Test a read-only contract call
curl -X POST http://localhost:3000/api/v1/vault/simulate-deposit \
  -H "Content-Type: application/json" \
  -d '{
    "user": "GXXX...",
    "amount": "100"
  }' | jq .

# Should return simulation result without errors
```

---

### Step 6: Monitor Performance (2 minutes)

#### 6.1 Check Response Times

```bash
# Measure RPC response time
for i in {1..10}; do
  time curl -s http://localhost:3000/api/v1/vault/summary > /dev/null
  sleep 1
done

# Average should be < 1 second
```

#### 6.2 Monitor Error Rate

```bash
# Watch logs for errors
tail -f /var/log/yieldvault/backend.log | grep -i error

# Should see no RPC-related errors
```

#### 6.3 Check Metrics Dashboard

```bash
# If using monitoring (Grafana, etc.)
# - Check RPC latency metrics
# - Check error rate
# - Check success rate
# - Compare with baseline
```

---

### Step 7: Update Frontend (if needed)

If frontend connects directly to RPC:

```bash
# Update frontend environment
cd /app/yieldvault-frontend

# Backup current config
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Update RPC URL
sed -i "s|VITE_SOROBAN_RPC_URL=.*|VITE_SOROBAN_RPC_URL=$BACKUP_RPC|" .env

# Rebuild and redeploy frontend
npm run build
# Deploy to CDN/hosting
```

---

### Step 8: Post-Failover Actions (1 minute)

#### 8.1 Document Change

```bash
# Log the failover
cat >> /var/log/yieldvault/rpc_changes.log <<EOF
=== RPC Failover ===
Date: $(date -Iseconds)
From: $PRIMARY_RPC
To: $BACKUP_RPC
Reason: Primary RPC unresponsive
Performed By: $(whoami)
Incident: INCIDENT-123
Status: Success
EOF
```

#### 8.2 Notify Team

```bash
# Send Slack notification
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "⚠️ RPC Failover Completed",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*RPC Failover*\n• From: Primary RPC\n• To: Backup RPC\n• Downtime: ~2 minutes\n• Status: Operational"
        }
      }
    ]
  }'
```

#### 8.3 Create Follow-up Tasks

- [ ] Investigate primary RPC failure
- [ ] Contact primary RPC provider
- [ ] Monitor backup RPC performance
- [ ] Plan return to primary (if applicable)
- [ ] Update documentation

---

## Rollback Procedure

To switch back to primary RPC:

### When to Rollback

- Primary RPC is restored and healthy
- Backup RPC has issues
- Performance is better on primary
- Cost considerations

### Rollback Steps

```bash
# 1. Verify primary RPC is healthy
curl -X POST "$PRIMARY_RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "getHealth"}' | jq .

# 2. Update configuration
cd /app/yieldvault-backend
sed -i "s|STELLAR_RPC_URL=.*|STELLAR_RPC_URL=$PRIMARY_RPC|" .env

# 3. Restart service
sudo systemctl restart yieldvault-backend

# 4. Verify
curl -s http://localhost:3000/health | jq .

# 5. Monitor for 10 minutes
tail -f /var/log/yieldvault/backend.log | grep -i "stellar\|rpc"
```

---

## Troubleshooting

### Issue: Backup RPC Also Fails

**Symptoms:** Backup RPC returns errors or timeouts

**Solutions:**
1. Try next backup in list
2. Check network connectivity
3. Verify RPC provider status page
4. Consider temporary degraded service
5. Escalate to senior engineer

### Issue: Wrong Network Passphrase

**Symptoms:** "Invalid network passphrase" errors

**Solutions:**
1. Verify RPC network (testnet vs mainnet)
2. Update STELLAR_NETWORK_PASSPHRASE to match
3. Restart service
4. Verify contract calls work

### Issue: Rate Limiting on Backup RPC

**Symptoms:** 429 Too Many Requests errors

**Solutions:**
1. Implement request throttling in application
2. Upgrade RPC provider plan
3. Switch to different backup RPC
4. Implement request caching

### Issue: Slow Performance on Backup RPC

**Symptoms:** Increased response times

**Solutions:**
1. Check RPC provider status
2. Verify network latency: `ping rpc-host`
3. Consider geographic proximity
4. Switch to faster backup RPC
5. Implement timeout adjustments

---

## Automated Failover (Advanced)

### Setup Health Checks

```javascript
// backend/src/rpcHealthCheck.ts
import { Server } from '@stellar/stellar-sdk/rpc';

const PRIMARY_RPC = process.env.STELLAR_RPC_URL;
const BACKUP_RPC = process.env.STELLAR_RPC_URL_BACKUP;

let currentRpc = PRIMARY_RPC;
let failoverCount = 0;

async function checkRpcHealth(url: string): Promise<boolean> {
  try {
    const server = new Server(url);
    const health = await server.getHealth();
    return health.status === 'healthy';
  } catch (error) {
    return false;
  }
}

async function autoFailover() {
  const primaryHealthy = await checkRpcHealth(PRIMARY_RPC);
  
  if (!primaryHealthy && currentRpc === PRIMARY_RPC) {
    console.warn('Primary RPC unhealthy, failing over to backup');
    currentRpc = BACKUP_RPC;
    failoverCount++;
    
    // Send alert
    await sendAlert('RPC failover to backup');
  } else if (primaryHealthy && currentRpc === BACKUP_RPC) {
    console.info('Primary RPC restored, failing back');
    currentRpc = PRIMARY_RPC;
    
    // Send alert
    await sendAlert('RPC failback to primary');
  }
  
  return currentRpc;
}

// Check every 30 seconds
setInterval(autoFailover, 30000);
```

---

## RPC Provider Comparison

| Provider | Testnet | Mainnet | Rate Limit | Latency | Cost | Reliability |
|----------|---------|---------|------------|---------|------|-------------|
| Stellar Foundation | ✓ | ✓ | Moderate | Low | Free | High |
| QuickNode | ✓ | ✓ | High | Very Low | $$$ | Very High |
| Ankr | ✓ | ✓ | Moderate | Low | $$ | High |
| Self-Hosted | ✓ | ✓ | None | Varies | $ | Varies |

---

## Verification Checklist

After failover, verify:

- [ ] Backup RPC is healthy
- [ ] Service restarted successfully
- [ ] Health checks pass
- [ ] RPC connectivity works
- [ ] Contract queries succeed
- [ ] No errors in logs
- [ ] Response times acceptable
- [ ] Frontend works (if applicable)
- [ ] Monitoring shows healthy state
- [ ] Team notified
- [ ] Change documented

---

## Metrics to Track

Document these metrics for each failover:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Detection Time | 1 min | ___ min | ___ |
| Decision Time | 1 min | ___ min | ___ |
| Configuration Update | 1 min | ___ min | ___ |
| Service Restart | 1 min | ___ min | ___ |
| Verification | 1 min | ___ min | ___ |
| **Total RTO** | **5 min** | **___ min** | **___** |
| Errors During Failover | 0 | ___ | ___ |

---

## Related Runbooks

- [RTO/RPO Targets](./RTO_RPO_TARGETS.md)
- [Backend Redeployment](./BACKEND_REDEPLOY.md)
- [Database Restore](./DATABASE_RESTORE.md)
- [Full Disaster Recovery](./FULL_DR_PROCEDURE.md)

---

## Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| DevOps Lead | TBD | TBD | TBD |
| Infrastructure Lead | TBD | TBD | TBD |
| On-Call Engineer | TBD | TBD | TBD |
| RPC Provider Support | TBD | TBD | TBD |

**PagerDuty:** [Escalation Policy Link]  
**Slack Channel:** #yieldvault-incidents

---

**Last Updated:** April 29, 2026  
**Next Review:** July 29, 2026  
**Tested:** ⚠️ Never - Schedule test ASAP
