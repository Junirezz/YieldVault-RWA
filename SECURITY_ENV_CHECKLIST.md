# Environment Variable Security Checklist

## Pre-Deployment Checklist

Use this checklist before deploying to any environment to ensure secrets are properly managed.

### 1. File Structure ✓

- [ ] `.env.example` files exist for backend and frontend
- [ ] `.env.local.example` files exist for local development
- [ ] `.env.production.example` files exist for production
- [ ] All `.env` files (except `.example`) are in `.gitignore`
- [ ] No actual `.env` files are committed to git

### 2. Git Security ✓

- [ ] Run `git log -p | grep -i "api_key\|secret\|password"` - no secrets found
- [ ] Run `git ls-files | grep "\.env$"` - no .env files tracked
- [ ] All team members aware of secret management policy
- [ ] Pre-commit hooks configured (optional but recommended)

### 3. Backend Configuration ✓

- [ ] `STELLAR_RPC_URL` uses environment variable
- [ ] `STELLAR_NETWORK_PASSPHRASE` uses environment variable
- [ ] `VAULT_CONTRACT_ID` uses environment variable
- [ ] `DATABASE_URL` uses environment variable
- [ ] `EMAIL_API_KEY` uses environment variable
- [ ] `SLACK_WEBHOOK_URL` uses environment variable
- [ ] `PAGERDUTY_INTEGRATION_KEY` uses environment variable
- [ ] No hardcoded secrets in source code

### 4. Frontend Configuration ✓

- [ ] `VITE_SOROBAN_RPC_URL` uses environment variable
- [ ] `VITE_STELLAR_NETWORK_PASSPHRASE` uses environment variable
- [ ] `VITE_VAULT_CONTRACT_ID` uses environment variable
- [ ] `VITE_API_BASE_URL` uses environment variable
- [ ] No hardcoded contract IDs in source code
- [ ] No hardcoded API endpoints in source code

### 5. Network Configuration ✓

- [ ] Testnet uses testnet RPC URL and passphrase
- [ ] Production uses mainnet RPC URL and passphrase
- [ ] Contract IDs match the network (testnet vs mainnet)
- [ ] CORS origins restricted to appropriate domains

### 6. Database Security ✓

- [ ] Production database uses SSL (`sslmode=require`)
- [ ] Database credentials are not in source code
- [ ] Connection pooling configured appropriately
- [ ] Replica URLs configured if using read replicas

### 7. API Keys & Secrets ✓

- [ ] Email API keys are production-grade for production
- [ ] Slack webhooks point to correct channels
- [ ] PagerDuty keys are for correct environment
- [ ] All API keys are different between environments
- [ ] API keys have appropriate permissions (least privilege)

### 8. Deployment Files ✓

- [ ] `deployments/contracts.testnet.json` has empty or testnet IDs
- [ ] `deployments/contracts.mainnet.json` has empty or mainnet IDs
- [ ] Deployment files don't contain secrets
- [ ] Deployment scripts use environment variables

### 9. CI/CD Configuration ✓

- [ ] GitHub Secrets configured for all required variables
- [ ] CI/CD doesn't log sensitive information
- [ ] Build artifacts don't contain secrets
- [ ] Environment-specific builds use correct variables

### 10. Documentation ✓

- [ ] `ENVIRONMENT_SETUP_GUIDE.md` is up to date
- [ ] Team members know how to access secrets
- [ ] Secret rotation schedule documented
- [ ] Incident response plan includes secret rotation

---

## Verification Commands

Run these commands to verify your setup:

### 1. Check for committed secrets
```bash
./scripts/verify-env-security.sh
```

### 2. Check git history for secrets
```bash
git log -p | grep -i "api_key\|secret\|password\|private"
```

### 3. Check for hardcoded addresses
```bash
grep -r "G[A-Z0-9]\{55\}" frontend/src backend/src --exclude="*.test.*" --exclude="*.spec.*"
```

### 4. Verify .gitignore
```bash
git check-ignore -v .env .env.local .env.production
```

### 5. Check tracked files
```bash
git ls-files | grep "\.env"
```

---

## Environment-Specific Checklists

### Local Development

- [ ] `.env.local` created from `.env.local.example`
- [ ] Testnet RPC URL configured
- [ ] Local database connection string set
- [ ] Mock/test API keys used (not production)
- [ ] Debug mode enabled

### Staging/Testing

- [ ] `.env.staging` created with staging values
- [ ] Testnet RPC URL configured
- [ ] Staging database connection string set
- [ ] Staging API keys configured
- [ ] Staging alert channels configured

### Production

- [ ] `.env.production` created with production values
- [ ] Mainnet RPC URL configured
- [ ] Production database with SSL configured
- [ ] Production API keys configured
- [ ] Production alert channels configured
- [ ] CORS restricted to production domains only
- [ ] Rate limiting configured appropriately
- [ ] All secrets rotated from staging

---

## Secret Rotation Schedule

| Secret Type | Frequency | Last Rotated | Next Rotation |
|-------------|-----------|--------------|---------------|
| Database Password | 90 days | - | - |
| Email API Key | 180 days | - | - |
| Slack Webhook | As needed | - | - |
| PagerDuty Key | 180 days | - | - |
| Admin API Keys | 90 days | - | - |

---

## Incident Response

### If a secret is leaked:

1. **Immediate Actions** (within 1 hour)
   - [ ] Rotate the compromised secret immediately
   - [ ] Revoke the old secret/key
   - [ ] Update all environments with new secret
   - [ ] Check logs for unauthorized access

2. **Investigation** (within 24 hours)
   - [ ] Determine scope of exposure
   - [ ] Check git history for secret
   - [ ] Review access logs
   - [ ] Identify how leak occurred

3. **Remediation** (within 48 hours)
   - [ ] Remove secret from git history if committed
   - [ ] Update documentation
   - [ ] Notify affected parties if necessary
   - [ ] Implement preventive measures

4. **Prevention** (within 1 week)
   - [ ] Add pre-commit hooks
   - [ ] Update team training
   - [ ] Review and update security policies
   - [ ] Conduct security audit

---

## Tools & Resources

### Recommended Tools

1. **git-secrets** - Prevents committing secrets
   ```bash
   brew install git-secrets
   git secrets --install
   git secrets --register-aws
   ```

2. **truffleHog** - Finds secrets in git history
   ```bash
   docker run --rm -v $(pwd):/proj dxa4481/trufflehog file:///proj
   ```

3. **detect-secrets** - Baseline secret detection
   ```bash
   pip install detect-secrets
   detect-secrets scan > .secrets.baseline
   ```

### Secret Management Services

- **AWS Secrets Manager** - For AWS deployments
- **HashiCorp Vault** - For multi-cloud
- **Azure Key Vault** - For Azure deployments
- **Google Secret Manager** - For GCP deployments
- **1Password** / **LastPass** - For team secret sharing

---

## Sign-Off

Before deploying to production, this checklist must be reviewed and signed off by:

- [ ] Developer: _________________ Date: _______
- [ ] DevOps: _________________ Date: _______
- [ ] Security: _________________ Date: _______

---

**Last Updated:** April 29, 2026  
**Next Review:** July 29, 2026  
**Owner:** Security Team
