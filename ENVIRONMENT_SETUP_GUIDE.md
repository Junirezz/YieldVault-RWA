# Environment Variable Management Guide

## Overview

This guide explains how to securely manage environment variables across different environments (local, staging, production) for the YieldVault RWA project.

## Security Principles

1. **Never commit secrets** - All `.env` files (except `.env.example`) are gitignored
2. **Environment-specific configs** - Use separate files for each environment
3. **Principle of least privilege** - Only include necessary secrets in each environment
4. **Rotation policy** - Regularly rotate API keys and secrets
5. **Audit trail** - Track who has access to production secrets

---

## File Structure

```
project-root/
├── .env.example                    # Template (safe to commit)
├── .env                            # Active config (NEVER commit)
├── .env.local                      # Local development (NEVER commit)
├── .env.production                 # Production (NEVER commit)
├── backend/
│   ├── .env.example                # Backend template
│   ├── .env.local.example          # Local dev template
│   ├── .env.production.example     # Production template
│   ├── .env                        # Active backend config (NEVER commit)
│   ├── .env.local                  # Local backend config (NEVER commit)
│   └── .env.production             # Production backend config (NEVER commit)
└── frontend/
    ├── .env.example                # Frontend template
    ├── .env.local.example          # Local dev template
    ├── .env.production.example     # Production template
    ├── .env                        # Active frontend config (NEVER commit)
    ├── .env.local                  # Local frontend config (NEVER commit)
    └── .env.production             # Production frontend config (NEVER commit)
```

---

## Setup Instructions

### 1. Local Development Setup

#### Backend

```bash
cd backend

# Copy the local development template
cp .env.local.example .env.local

# Edit with your local values
nano .env.local  # or use your preferred editor

# Required changes:
# - VAULT_CONTRACT_ID: Your testnet contract ID
# - DATABASE_URL: Your local database connection string
# - EMAIL_API_KEY: (optional for local dev)
# - SLACK_WEBHOOK_URL: (optional for local dev)
```

#### Frontend

```bash
cd frontend

# Copy the local development template
cp .env.local.example .env.local

# Edit with your local values
nano .env.local

# Required changes:
# - VITE_VAULT_CONTRACT_ID: Your testnet contract ID
# - VITE_API_BASE_URL: Your local backend URL (default: http://localhost:3000)
```

### 2. Production Setup

#### Backend

```bash
cd backend

# Copy the production template
cp .env.production.example .env.production

# Edit with your production values
nano .env.production

# CRITICAL changes required:
# - STELLAR_RPC_URL: https://soroban-mainnet.stellar.org
# - STELLAR_NETWORK_PASSPHRASE: Public Global Stellar Network ; September 2015
# - VAULT_CONTRACT_ID: Your mainnet contract ID
# - DATABASE_URL: Production database with SSL
# - EMAIL_API_KEY: Production email service key
# - SLACK_WEBHOOK_URL: Production Slack webhook
# - PAGERDUTY_INTEGRATION_KEY: Production PagerDuty key
# - CORS_ALLOWED_ORIGINS: Production domains only
```

#### Frontend

```bash
cd frontend

# Copy the production template
cp .env.production.example .env.production

# Edit with your production values
nano .env.production

# CRITICAL changes required:
# - VITE_SOROBAN_RPC_URL: https://soroban-mainnet.stellar.org
# - VITE_STELLAR_NETWORK_PASSPHRASE: Public Global Stellar Network ; September 2015
# - VITE_VAULT_CONTRACT_ID: Your mainnet contract ID
# - VITE_API_BASE_URL: Production API URL
# - VITE_SENTRY_DSN: Production Sentry DSN
```

---

## Environment Variables Reference

### Backend Environment Variables

#### Required for All Environments

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development`, `production` |
| `STELLAR_RPC_URL` | Stellar RPC endpoint | `https://soroban-testnet.stellar.org` |
| `STELLAR_NETWORK` | Network identifier | `testnet`, `mainnet` |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |
| `VAULT_CONTRACT_ID` | Deployed vault contract ID | `C...` (56 chars) |

#### Security & Authentication

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Primary database connection | Production |
| `DATABASE_REPLICA_URL` | Read replica connection | Production (optional) |
| `EMAIL_API_KEY` | Email service API key | Production |
| `SLACK_WEBHOOK_URL` | Slack alerts webhook | Production |
| `PAGERDUTY_INTEGRATION_KEY` | PagerDuty integration key | Production |

#### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |
| `CORS_ALLOWED_ORIGINS` | Allowed CORS origins | Comma-separated list |
| `SLO_READ_THRESHOLD_MS` | Read SLO threshold | `200` |
| `SLO_WRITE_THRESHOLD_MS` | Write SLO threshold | `500` |

### Frontend Environment Variables

#### Required for All Environments

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SOROBAN_RPC_URL` | Stellar RPC endpoint | `https://soroban-testnet.stellar.org` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |
| `VITE_VAULT_CONTRACT_ID` | Vault contract ID | `C...` (56 chars) |

#### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API URL | `http://localhost:3000` |
| `VITE_SENTRY_DSN` | Sentry error tracking | - |
| `VITE_FF_ANALYTICS_PAGE` | Feature flag: Analytics | `true` |
| `VITE_FF_ADVANCED_CHARTS` | Feature flag: Charts | `false` |
| `VITE_FF_DEBUG_MODE` | Feature flag: Debug | `false` |

---

## Security Checklist

### Before Deployment

- [ ] All `.env` files are in `.gitignore`
- [ ] No secrets in git history (`git log -p | grep -i "api_key\|secret\|password"`)
- [ ] Production secrets are different from development
- [ ] Database connections use SSL in production
- [ ] CORS origins are restricted to production domains
- [ ] Rate limiting is enabled and configured appropriately
- [ ] Email API keys are production-grade
- [ ] Alert webhooks point to production channels
- [ ] Contract IDs are verified for correct network (mainnet vs testnet)

### After Deployment

- [ ] Verify environment variables are loaded correctly
- [ ] Test database connectivity
- [ ] Verify contract interactions work
- [ ] Check CORS configuration
- [ ] Test alert integrations
- [ ] Monitor logs for any exposed secrets
- [ ] Set up secret rotation schedule

---

## Secret Management Best Practices

### 1. Use Secret Management Services

For production, consider using:
- **AWS Secrets Manager** - For AWS deployments
- **HashiCorp Vault** - For multi-cloud or on-premise
- **Azure Key Vault** - For Azure deployments
- **Google Secret Manager** - For GCP deployments

### 2. Environment Variable Loading

```typescript
// backend/src/config.ts
export const config = {
  stellar: {
    rpcUrl: process.env.STELLAR_RPC_URL || '',
    network: process.env.STELLAR_NETWORK || 'testnet',
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || '',
    vaultContractId: process.env.VAULT_CONTRACT_ID || '',
  },
  database: {
    url: process.env.DATABASE_URL || '',
    replicaUrl: process.env.DATABASE_REPLICA_URL,
  },
  // Validate required variables
  validate() {
    const required = [
      'STELLAR_RPC_URL',
      'STELLAR_NETWORK_PASSPHRASE',
      'VAULT_CONTRACT_ID',
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
};

// Call validate on startup
config.validate();
```

### 3. Secret Rotation

Implement a rotation schedule:

| Secret Type | Rotation Frequency | Priority |
|-------------|-------------------|----------|
| Database passwords | 90 days | High |
| API keys | 180 days | High |
| Webhook URLs | As needed | Medium |
| Contract IDs | Never (immutable) | N/A |

### 4. Access Control

Maintain a secret access matrix:

| Secret | Development | Staging | Production | CI/CD |
|--------|-------------|---------|------------|-------|
| Database URL | ✓ | ✓ | ✓ | ✓ |
| Email API Key | Mock | ✓ | ✓ | ✗ |
| Slack Webhook | Dev channel | Staging channel | Prod channel | ✗ |
| Contract ID | Testnet | Testnet | Mainnet | ✓ |

---

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup environment variables
        run: |
          echo "STELLAR_RPC_URL=${{ secrets.STELLAR_RPC_URL }}" >> .env.production
          echo "VAULT_CONTRACT_ID=${{ secrets.VAULT_CONTRACT_ID }}" >> .env.production
          echo "DATABASE_URL=${{ secrets.DATABASE_URL }}" >> .env.production
          # Add other secrets...
      
      - name: Deploy
        run: |
          # Your deployment commands
```

### Required GitHub Secrets

Add these secrets to your repository settings:

**Backend Secrets:**
- `STELLAR_RPC_URL`
- `STELLAR_NETWORK_PASSPHRASE`
- `VAULT_CONTRACT_ID`
- `DATABASE_URL`
- `EMAIL_API_KEY`
- `SLACK_WEBHOOK_URL`
- `PAGERDUTY_INTEGRATION_KEY`

**Frontend Secrets:**
- `VITE_SOROBAN_RPC_URL`
- `VITE_STELLAR_NETWORK_PASSPHRASE`
- `VITE_VAULT_CONTRACT_ID`
- `VITE_API_BASE_URL`
- `VITE_SENTRY_DSN`

---

## Troubleshooting

### Issue: "Contract ID not configured"

**Cause:** `VAULT_CONTRACT_ID` or `VITE_VAULT_CONTRACT_ID` is not set

**Solution:**
```bash
# Backend
echo "VAULT_CONTRACT_ID=your-contract-id" >> backend/.env.local

# Frontend
echo "VITE_VAULT_CONTRACT_ID=your-contract-id" >> frontend/.env.local
```

### Issue: "Wrong network" error

**Cause:** Mismatch between contract network and RPC URL

**Solution:** Ensure both use the same network:
```bash
# For testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# For mainnet
STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

### Issue: CORS errors in production

**Cause:** `CORS_ALLOWED_ORIGINS` not configured correctly

**Solution:**
```bash
# Backend .env.production
CORS_ALLOWED_ORIGINS=https://app.yieldvault.finance,https://www.yieldvault.finance
```

### Issue: Database connection fails

**Cause:** Missing SSL or incorrect connection string

**Solution:**
```bash
# Add sslmode=require for production
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

---

## Verification Script

Create a script to verify environment setup:

```bash
#!/bin/bash
# scripts/verify-env.sh

echo "Verifying environment configuration..."

# Check backend
if [ -f "backend/.env.local" ]; then
  echo "✓ Backend .env.local exists"
else
  echo "✗ Backend .env.local missing"
fi

# Check frontend
if [ -f "frontend/.env.local" ]; then
  echo "✓ Frontend .env.local exists"
else
  echo "✗ Frontend .env.local missing"
fi

# Check for secrets in git
if git log -p | grep -q "VAULT_CONTRACT_ID=C"; then
  echo "⚠ WARNING: Possible secrets in git history!"
else
  echo "✓ No secrets detected in git history"
fi

# Verify .gitignore
if grep -q "^\.env$" .gitignore; then
  echo "✓ .env files are gitignored"
else
  echo "✗ .env files not in .gitignore"
fi

echo "Verification complete!"
```

---

## Support

For questions or issues with environment configuration:

1. Check this guide first
2. Review the `.env.example` files
3. Consult the team's secret management documentation
4. Contact DevOps team for production secret access

---

**Last Updated:** April 29, 2026  
**Maintained By:** DevOps Team  
**Review Schedule:** Quarterly
