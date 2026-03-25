# 🏦 YieldVault-RWA: Deployment & Operations Runbook

This document provides the necessary steps for deploying, initializing, and auditing the YieldVault-RWA smart contract on Stellar.

---

## 🛠 Pre-Deployment Checklist
- [ ] **Build:** `cargo build --target wasm32-unknown-unknown --release`
- [ ] **Optimize:** `soroban contract optimize --wasm target/wasm32-unknown-unknown/release/yield_vault_rwa.wasm`
- [ ] **Network:** Target network configured (e.g., `testnet` or `mainnet`).
- [ ] **Funding:** Deployer account has sufficient XLM.

---

## 🚀 Deployment Steps

### 1. Deploy the Contract
```bash
# This returns the CONTRACT_ID
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/yield_vault_rwa.optimized.wasm \
  --source deployer \
  --network testnet

soroban contract invoke \
  --id <PASTE_CONTRACT_ID_HERE> \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin <ADMIN_ADDRESS> \
  --token <TOKEN_ADDRESS>