# Environment Variable Setup - Quick Start

This guide provides quick setup instructions for environment variables in the YieldVault project.

## 🚀 Quick Setup

### For Local Development

```bash
# 1. Backend setup
cd backend
cp .env.local.example .env.local
# Edit .env.local with your values
nano .env.local

# 2. Frontend setup
cd ../frontend
cp .env.local.example .env.local
# Edit .env.local with your values
nano .env.local

# 3. Verify setup
cd ..
./scripts/verify-env-security.sh
```

### For Production Deployment

```bash
# 1. Backend setup
cd backend
cp .env.production.example .env.production
# Edit .env.production with production values
nano .env.production

# 2. Frontend setup
cd ../frontend
cp .env.production.example .env.production
# Edit .env.production with production values
nano .env.production

# 3. Verify setup
cd ..
./scripts/verify-env-security.sh
```

## 📋 Required Variables

### Backend (Minimum Required)

```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VAULT_CONTRACT_ID=your-contract-id-here
```

### Frontend (Minimum Required)

```bash
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=your-contract-id-here
```

## 🔒 Security Rules

1. **NEVER commit `.env` files** (except `.env.example`)
2. **Use different secrets** for each environment
3. **Rotate secrets regularly** (see schedule in SECURITY_ENV_CHECKLIST.md)
4. **Verify before deploying** using `./scripts/verify-env-security.sh`

## 📚 Documentation

- **Full Setup Guide:** [ENVIRONMENT_SETUP_GUIDE.md](./ENVIRONMENT_SETUP_GUIDE.md)
- **Security Checklist:** [SECURITY_ENV_CHECKLIST.md](./SECURITY_ENV_CHECKLIST.md)
- **Backend Env Docs:** [backend/docs/ENVIRONMENT_VARIABLES.md](./backend/docs/ENVIRONMENT_VARIABLES.md)

## 🛠️ Troubleshooting

### "Contract ID not configured"
```bash
# Make sure you've set the contract ID in your .env file
echo "VAULT_CONTRACT_ID=your-id" >> backend/.env.local
echo "VITE_VAULT_CONTRACT_ID=your-id" >> frontend/.env.local
```

### "Wrong network" error
```bash
# Ensure RPC URL and passphrase match
# For testnet:
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# For mainnet:
STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

### CORS errors
```bash
# Add your frontend URL to backend CORS
echo "CORS_ALLOWED_ORIGINS=http://localhost:5173" >> backend/.env.local
```

## ✅ Verification

Run the security verification script:

```bash
./scripts/verify-env-security.sh
```

This checks:
- ✓ .env files are gitignored
- ✓ No secrets committed to git
- ✓ No hardcoded secrets in code
- ✓ Proper file structure
- ✓ No secrets in git history

## 🆘 Support

If you need help:
1. Check the [ENVIRONMENT_SETUP_GUIDE.md](./ENVIRONMENT_SETUP_GUIDE.md)
2. Review example files (`.env.*.example`)
3. Contact the DevOps team
4. Check the troubleshooting section above

---

**Quick Links:**
- [Environment Setup Guide](./ENVIRONMENT_SETUP_GUIDE.md)
- [Security Checklist](./SECURITY_ENV_CHECKLIST.md)
- [Backend .env.example](./backend/.env.example)
- [Frontend .env.example](./frontend/.env.example)
