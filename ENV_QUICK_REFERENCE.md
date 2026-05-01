# Environment Variables - Quick Reference Card

## 🚨 Critical Rules

1. **NEVER** commit `.env` files (except `.env.example`)
2. **ALWAYS** use environment variables for secrets
3. **VERIFY** before deploying: `./scripts/verify-env-security.sh`
4. **ROTATE** secrets every 90-180 days

---

## 📁 File Naming Convention

| File | Purpose | Commit to Git? |
|------|---------|----------------|
| `.env.example` | Template with empty values | ✅ YES |
| `.env.local.example` | Local dev template | ✅ YES |
| `.env.production.example` | Production template | ✅ YES |
| `.env` | Active configuration | ❌ NO |
| `.env.local` | Local development | ❌ NO |
| `.env.production` | Production | ❌ NO |

---

## ⚡ Quick Setup Commands

### Local Development
```bash
# Backend
cp backend/.env.local.example backend/.env.local
# Edit backend/.env.local

# Frontend
cp frontend/.env.local.example frontend/.env.local
# Edit frontend/.env.local

# Verify
./scripts/verify-env-security.sh
```

### Production
```bash
# Backend
cp backend/.env.production.example backend/.env.production
# Edit backend/.env.production

# Frontend
cp frontend/.env.production.example frontend/.env.production
# Edit frontend/.env.production

# Verify
./scripts/verify-env-security.sh
```

---

## 🔑 Essential Variables

### Backend (Minimum)
```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VAULT_CONTRACT_ID=your-contract-id
```

### Frontend (Minimum)
```bash
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=your-contract-id
```

---

## 🌐 Network Configuration

### Testnet
```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

### Mainnet (Production Only!)
```bash
STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

---

## 🛠️ Common Issues & Fixes

### "Contract ID not configured"
```bash
echo "VAULT_CONTRACT_ID=your-id" >> backend/.env.local
echo "VITE_VAULT_CONTRACT_ID=your-id" >> frontend/.env.local
```

### "Wrong network" error
Check RPC URL and passphrase match (both testnet or both mainnet)

### CORS errors
```bash
echo "CORS_ALLOWED_ORIGINS=http://localhost:5173" >> backend/.env.local
```

### Database connection fails
Add `?sslmode=require` for production databases

---

## ✅ Pre-Deployment Checklist

- [ ] Run `./scripts/verify-env-security.sh`
- [ ] Verify no `.env` files in git: `git ls-files | grep "\.env$"`
- [ ] Check network matches (testnet vs mainnet)
- [ ] Verify CORS origins are correct
- [ ] Confirm all secrets are production-grade
- [ ] Test database connectivity
- [ ] Verify contract ID is correct for network

---

## 📚 Documentation Links

- **Full Guide:** [ENVIRONMENT_SETUP_GUIDE.md](./ENVIRONMENT_SETUP_GUIDE.md)
- **Security Checklist:** [SECURITY_ENV_CHECKLIST.md](./SECURITY_ENV_CHECKLIST.md)
- **Quick Start:** [ENV_SETUP_README.md](./ENV_SETUP_README.md)
- **Implementation:** [ISSUE_38_IMPLEMENTATION_SUMMARY.md](./ISSUE_38_IMPLEMENTATION_SUMMARY.md)

---

## 🔒 Security Verification

```bash
# Run this before every deployment
./scripts/verify-env-security.sh
```

**What it checks:**
- ✓ .env files are gitignored
- ✓ No secrets committed
- ✓ No hardcoded secrets in code
- ✓ Proper file structure
- ✓ No secrets in git history

---

## 🆘 Emergency: Secret Leaked

1. **Immediately** rotate the secret
2. Revoke the old secret/key
3. Update all environments
4. Check logs for unauthorized access
5. Remove from git history if committed
6. Follow full incident response in [SECURITY_ENV_CHECKLIST.md](./SECURITY_ENV_CHECKLIST.md)

---

## 📞 Support

1. Check [ENV_SETUP_README.md](./ENV_SETUP_README.md)
2. Review example files
3. Run verification script
4. Contact DevOps team

---

**Print this card and keep it handy! 📌**
