# Full Disaster Recovery Procedure

**Purpose:** Complete system recovery from catastrophic failure  
**RTO Target:** 4 hours (can be reduced to 1.5 hours with standby infrastructure)  
**RPO Target:** 15 minutes  
**Last Updated:** April 29, 2026  
**Last Tested:** ⚠️ Never - Requires testing

---

## When to Use This Runbook

Use this runbook for complete infrastructure failure:
- Data center outage
- Multiple component failures
- Complete infrastructure loss
- Natural disaster
- Cyber attack requiring full rebuild
- Catastrophic hardware failure

**⚠️ This is the nuclear option. Use component-specific runbooks first.**

---

## Disaster Scenarios

### Scenario A: Complete Infrastructure Loss
- All servers down
- Database inaccessible
- Network infrastructure failed
- Requires full rebuild

### Scenario B: Data Center Outage
- Primary data center unavailable
- Need to failover to secondary region
- Infrastructure intact but inaccessible

### Scenario C: Ransomware/Security Breach
- Systems compromised
- Need to rebuild from clean backups
- Security audit required

---

## Prerequisites

### Required Access
- [ ] Cloud provider admin access (AWS/GCP/Azure)
- [ ] DNS management access
- [ ] Backup storage access
- [ ] Git repository access
- [ ] Secret management access
- [ ] Domain registrar access

### Required Resources
- [ ] Backup infrastructure (or ability to provision)
- [ ] Database backups (verified)
- [ ] Application source code (git)
- [ ] Configuration backups
- [ ] SSL certificates
- [ ] API keys and secrets

### Required Team
- [ ] Incident Commander
- [ ] Database Administrator
- [ ] DevOps Engineer
- [ ] Backend Engineer
- [ ] Frontend Engineer
- [ ] Security Engineer (if breach)

---

## Pre-Recovery Checklist

- [ ] **Declare disaster** - Activate DR plan
- [ ] **Assemble team** - Get all hands on deck
- [ ] **Create war room** - Dedicated Slack channel/Zoom
- [ ] **Notify stakeholders** - Management, customers
- [ ] **Document everything** - Start incident log
- [ ] **Assess scope** - What's affected?
- [ ] **Verify backups** - Ensure backups are accessible
- [ ] **Secure funding** - Approve emergency spending

---

## Recovery Procedure

### Phase 1: Assessment & Planning (30 minutes)

#### 1.1 Assess Damage

```bash
# Document what's down
- [ ] Database servers
- [ ] Application servers
- [ ] Load balancers
- [ ] DNS
- [ ] Monitoring
- [ ] Backups accessible?
```

#### 1.2 Determine Recovery Strategy

**Option A: Rebuild in Same Location**
- Pros: Familiar infrastructure, existing DNS
- Cons: May take longer, same failure point
- Time: 4 hours

**Option B: Failover to Secondary Region**
- Pros: Faster if pre-provisioned, geographic diversity
- Cons: Requires pre-setup, DNS changes
- Time: 1.5 hours (if pre-provisioned)

**Option C: Hybrid Approach**
- Pros: Balance of speed and reliability
- Cons: More complex
- Time: 2-3 hours

#### 1.3 Create Recovery Plan

```markdown
## Recovery Plan

**Strategy:** [A/B/C]
**Target RTO:** [X hours]
**Target RPO:** [X minutes]

**Phase 1:** Infrastructure (60 min)
**Phase 2:** Database (60 min)
**Phase 3:** Backend (30 min)
**Phase 4:** Frontend (15 min)
**Phase 5:** Verification (30 min)

**Team Assignments:**
- Infrastructure: [Name]
- Database: [Name]
- Backend: [Name]
- Frontend: [Name]
- Verification: [Name]
```

---

### Phase 2: Infrastructure Provisioning (60 minutes)

#### 2.1 Provision Compute Resources

```bash
# Using AWS (example)
# Provision EC2 instances
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.large \
  --key-name yieldvault-key \
  --security-group-ids sg-xxx \
  --subnet-id subnet-xxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=yieldvault-backend-dr}]' \
  --count 2

# Provision RDS instance
aws rds create-db-instance \
  --db-instance-identifier yieldvault-db-dr \
  --db-instance-class db.t3.large \
  --engine postgres \
  --master-username admin \
  --master-user-password [secure-password] \
  --allocated-storage 100 \
  --backup-retention-period 7 \
  --multi-az

# Or using Terraform
cd /infrastructure/terraform
terraform init
terraform plan -out=dr-plan
terraform apply dr-plan
```

#### 2.2 Configure Networking

```bash
# Set up VPC, subnets, security groups
# Configure load balancer
# Set up DNS (may need to wait for propagation)

# Update DNS to point to new infrastructure
# (if using Route53)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://dns-change.json
```

#### 2.3 Install Base Software

```bash
# SSH to new servers
ssh -i yieldvault-key.pem ubuntu@new-server-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL client
sudo apt install -y postgresql-client

# Install Docker (if using)
curl -fsSL https://get.docker.com | sudo sh

# Install monitoring agents
# Install security tools
```

---

### Phase 3: Database Recovery (60 minutes)

#### 3.1 Restore Database

Follow [Database Restore Runbook](./DATABASE_RESTORE.md) with these modifications:

```bash
# Download latest backup from S3
aws s3 cp s3://yieldvault-backups/database/latest.dump /tmp/

# Restore to new database
pg_restore \
  --dbname="postgresql://admin:password@new-db-host:5432/yieldvault_prod" \
  --verbose \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --jobs=4 \
  /tmp/latest.dump

# Verify restore
psql "postgresql://admin:password@new-db-host:5432/yieldvault_prod" \
  -c "SELECT COUNT(*) FROM \"Transaction\";"
```

#### 3.2 Configure Database

```bash
# Update connection pooling
# Configure replication (if multi-region)
# Set up monitoring
# Configure backups
```

#### 3.3 Verify Database

```bash
# Run integrity checks
psql $NEW_DATABASE_URL -c "
  SELECT schemaname, tablename, n_live_tup 
  FROM pg_stat_user_tables 
  ORDER BY n_live_tup DESC;
"

# Verify critical data
psql $NEW_DATABASE_URL -c "
  SELECT 
    (SELECT COUNT(*) FROM \"User\") as users,
    (SELECT COUNT(*) FROM \"Transaction\") as transactions,
    (SELECT COUNT(*) FROM \"VaultState\") as vault_states;
"
```

---

### Phase 4: Backend Deployment (30 minutes)

#### 4.1 Deploy Backend Application

Follow [Backend Redeployment Runbook](./BACKEND_REDEPLOY.md):

```bash
# Clone repository
cd /app
git clone https://github.com/yieldvault/backend.git yieldvault-backend
cd yieldvault-backend

# Checkout production branch
git checkout main

# Install dependencies
npm ci --production

# Build application
npm run build

# Configure environment
cp .env.example .env
nano .env
# Update with new database URL, RPC URL, etc.

# Run migrations
npx prisma migrate deploy

# Start application
npm start

# Or use PM2
pm2 start dist/index.js --name yieldvault-backend
pm2 save
```

#### 4.2 Configure Load Balancer

```bash
# Add backend servers to load balancer
# Configure health checks
# Set up SSL termination
# Configure routing rules
```

#### 4.3 Verify Backend

```bash
# Test health endpoint
curl https://api-dr.yieldvault.finance/health

# Test database connectivity
curl https://api-dr.yieldvault.finance/api/v1/vault/summary

# Check logs
tail -f /var/log/yieldvault/backend.log
```

---

### Phase 5: Frontend Deployment (15 minutes)

#### 5.1 Build and Deploy Frontend

```bash
# Clone repository
cd /app
git clone https://github.com/yieldvault/frontend.git yieldvault-frontend
cd yieldvault-frontend

# Install dependencies
npm ci

# Configure environment
cp .env.example .env
nano .env
# Update API URL, RPC URL, contract ID

# Build for production
npm run build

# Deploy to CDN/hosting
# (depends on your setup - S3, Netlify, Vercel, etc.)
aws s3 sync dist/ s3://yieldvault-frontend-dr/ --delete
aws cloudfront create-invalidation --distribution-id E123456 --paths "/*"
```

#### 5.2 Update DNS

```bash
# Point frontend domain to new hosting
# Update CDN configuration
# Verify SSL certificates
```

#### 5.3 Verify Frontend

```bash
# Test frontend loads
curl -I https://app-dr.yieldvault.finance

# Test in browser
# - Can load application
# - Can connect wallet
# - Can view vault data
# - Can simulate transactions
```

---

### Phase 6: External Services (15 minutes)

#### 6.1 Reconfigure Integrations

```bash
# Update Stellar RPC (if needed)
# Follow RPC Failover Runbook if primary RPC is down

# Verify email service
curl -X POST https://api-dr.yieldvault.finance/admin/test-email

# Verify monitoring
# - Update monitoring endpoints
# - Verify alerts are working
# - Update dashboards

# Verify logging
# - Configure log aggregation
# - Verify logs are flowing
```

#### 6.2 Update Webhooks

```bash
# Update Slack webhook URLs (if changed)
# Update PagerDuty integration
# Update any third-party webhooks
```

---

### Phase 7: Verification & Testing (30 minutes)

#### 7.1 Smoke Tests

```bash
# Test critical user flows
./scripts/smoke-test.sh

# Test deposit flow (simulation)
curl -X POST https://api-dr.yieldvault.finance/api/v1/vault/simulate-deposit \
  -H "Content-Type: application/json" \
  -d '{"user": "GXXX...", "amount": "100"}'

# Test withdrawal flow (simulation)
curl -X POST https://api-dr.yieldvault.finance/api/v1/vault/simulate-withdraw \
  -H "Content-Type: application/json" \
  -d '{"user": "GXXX...", "shares": "50"}'

# Test vault queries
curl https://api-dr.yieldvault.finance/api/v1/vault/summary
curl https://api-dr.yieldvault.finance/api/v1/vault/metrics
curl https://api-dr.yieldvault.finance/api/v1/vault/apy
```

#### 7.2 End-to-End Tests

```bash
# Run automated test suite
cd /app/yieldvault-backend
npm test

cd /app/yieldvault-frontend
npm test

# Manual testing
# - Connect wallet
# - View portfolio
# - Simulate deposit
# - View transaction history
# - Check analytics
```

#### 7.3 Performance Tests

```bash
# Load test critical endpoints
ab -n 1000 -c 10 https://api-dr.yieldvault.finance/api/v1/vault/summary

# Monitor response times
# Monitor error rates
# Monitor resource usage
```

#### 7.4 Security Verification

```bash
# Verify SSL certificates
openssl s_client -connect api-dr.yieldvault.finance:443 -servername api-dr.yieldvault.finance

# Verify CORS configuration
curl -H "Origin: https://malicious.com" https://api-dr.yieldvault.finance/api/v1/vault/summary

# Verify rate limiting
for i in {1..100}; do curl https://api-dr.yieldvault.finance/api/v1/vault/summary; done

# Run security scan (if time permits)
```

---

### Phase 8: Cutover (15 minutes)

#### 8.1 Final Verification

```bash
# Verify all systems operational
# Verify data integrity
# Verify no errors in logs
# Verify monitoring shows healthy
```

#### 8.2 Update DNS (if not done earlier)

```bash
# Point production domains to DR infrastructure
# api.yieldvault.finance -> new backend
# app.yieldvault.finance -> new frontend

# Wait for DNS propagation (can take up to 48 hours)
# Use low TTL to speed up propagation
```

#### 8.3 Enable Production Traffic

```bash
# Remove maintenance page
# Enable load balancer
# Monitor traffic flow
# Watch for errors
```

---

### Phase 9: Post-Recovery (30 minutes)

#### 9.1 Monitor Closely

```bash
# Watch logs continuously
tail -f /var/log/yieldvault/*.log

# Monitor metrics
# - Response times
# - Error rates
# - Resource usage
# - Database performance

# Set up alerts for anomalies
```

#### 9.2 Notify Stakeholders

```bash
# Send recovery notification
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "✅ Disaster Recovery Complete",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*System Recovered*\n• Total Downtime: 3.5 hours\n• Data Loss: 10 minutes\n• All systems operational\n• Monitoring active"
        }
      }
    ]
  }'

# Update status page
# Notify customers (if applicable)
# Notify management
```

#### 9.3 Document Recovery

```markdown
## Disaster Recovery Report

**Incident:** [ID]
**Date:** [Date]
**Duration:** [X hours]

### Timeline
- 00:00 - Disaster detected
- 00:30 - Team assembled
- 01:30 - Infrastructure provisioned
- 02:30 - Database restored
- 03:00 - Backend deployed
- 03:15 - Frontend deployed
- 03:45 - Verification complete
- 04:00 - Production traffic enabled

### Impact
- Downtime: 4 hours
- Data Loss: 15 minutes
- Affected Users: All
- Financial Impact: $X

### Root Cause
[Description]

### What Went Well
- [Item 1]
- [Item 2]

### What Could Be Improved
- [Item 1]
- [Item 2]

### Action Items
- [ ] [Action 1]
- [ ] [Action 2]
```

---

## Rollback Procedure

If DR recovery fails:

### Option 1: Return to Original Infrastructure

```bash
# If original infrastructure becomes available
# Switch DNS back
# Verify original systems are healthy
# Gradually migrate traffic back
```

### Option 2: Try Alternative DR Site

```bash
# If DR site has issues
# Provision in different region
# Repeat recovery procedure
```

### Option 3: Degraded Service

```bash
# If full recovery not possible
# Enable read-only mode
# Display maintenance message
# Provide status updates
```

---

## Troubleshooting

### Issue: Database Restore Fails

**Solutions:**
1. Try earlier backup
2. Restore to temporary database first
3. Use point-in-time recovery
4. Contact database expert
5. Consider partial restore

### Issue: DNS Not Propagating

**Solutions:**
1. Use low TTL (300 seconds)
2. Update /etc/hosts for testing
3. Use direct IP access temporarily
4. Contact DNS provider
5. Consider using different DNS provider

### Issue: SSL Certificate Issues

**Solutions:**
1. Use Let's Encrypt for quick cert
2. Import existing certificates
3. Use wildcard certificate
4. Temporarily use HTTP (not recommended)
5. Contact certificate authority

### Issue: Performance Issues

**Solutions:**
1. Scale up resources
2. Enable caching
3. Optimize database queries
4. Add read replicas
5. Use CDN for static assets

---

## Cost Estimate

### Emergency DR Costs

| Item | Cost | Duration | Total |
|------|------|----------|-------|
| Compute (2x t3.large) | $0.20/hr | 24 hrs | $9.60 |
| Database (db.t3.large) | $0.30/hr | 24 hrs | $7.20 |
| Load Balancer | $0.025/hr | 24 hrs | $0.60 |
| Data Transfer | $0.09/GB | 100 GB | $9.00 |
| Engineer Time (4 people) | $100/hr | 16 hrs | $6,400 |
| **Total** | | | **~$6,426** |

### Ongoing DR Costs (Standby)

| Item | Monthly Cost |
|------|--------------|
| Standby Infrastructure | $500 |
| Backup Storage | $50 |
| Monitoring | $100 |
| **Total** | **$650/month** |

---

## Prevention Measures

### Reduce RTO

1. **Pre-provision standby infrastructure** ($500/month)
   - Reduces RTO from 4 hours to 1.5 hours
   
2. **Implement multi-region deployment** ($1,000/month)
   - Reduces RTO to 30 minutes
   - Automatic failover

3. **Use managed services** (varies)
   - Reduces operational burden
   - Built-in redundancy

### Reduce RPO

1. **Increase backup frequency** (minimal cost)
   - From 15 minutes to 5 minutes
   
2. **Enable continuous replication** ($300/month)
   - Near-zero RPO
   - Real-time data sync

3. **Use distributed database** (varies)
   - Built-in replication
   - Automatic failover

---

## Testing Schedule

| Test Type | Frequency | Duration | Next Test |
|-----------|-----------|----------|-----------|
| Tabletop Exercise | Quarterly | 2 hours | TBD |
| Partial DR Test | Semi-annually | 4 hours | TBD |
| Full DR Test | Annually | 8 hours | TBD |
| Backup Restore Test | Monthly | 1 hour | TBD |

---

## Related Runbooks

- [RTO/RPO Targets](./RTO_RPO_TARGETS.md)
- [Database Restore](./DATABASE_RESTORE.md)
- [Backend Redeployment](./BACKEND_REDEPLOY.md)
- [RPC Failover](./RPC_FAILOVER.md)

---

## Emergency Contacts

| Role | Name | Phone | Email | Backup |
|------|------|-------|-------|--------|
| Incident Commander | TBD | TBD | TBD | TBD |
| Database Admin | TBD | TBD | TBD | TBD |
| DevOps Lead | TBD | TBD | TBD | TBD |
| Backend Lead | TBD | TBD | TBD | TBD |
| Frontend Lead | TBD | TBD | TBD | TBD |
| Security Lead | TBD | TBD | TBD | TBD |
| Team Lead | TBD | TBD | TBD | TBD |
| CEO/CTO | TBD | TBD | TBD | TBD |

**PagerDuty:** [Escalation Policy Link]  
**Slack Channel:** #yieldvault-war-room  
**Zoom Room:** [Emergency Meeting Link]

---

**Last Updated:** April 29, 2026  
**Next Review:** July 29, 2026  
**Tested:** ⚠️ Never - Schedule test ASAP  
**Status:** Draft - Requires approval and testing
