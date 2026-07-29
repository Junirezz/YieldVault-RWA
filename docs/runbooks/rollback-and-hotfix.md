# Production Runbook: Deployment Rollback & Hotfixes

## 1. Trigger Criteria & Incident Severity

### Severe Incidents (Triggers Rollback or Immediate Hotfix)
- **Financial/State Risk:** Vault balance accounting mismatch, unauthorized yield distribution, or smart contract logic flaw.
- **Service Outage:** Frontend or indexing API down/unresponsive post-deployment.
- **Security Vulnerability:** Exploitable entrypoint or leaked credentials/keys.

### Incident Roles
- **Incident Commander (IC):** Leads response, authorizes pauses or rollbacks.
- **Lead Developer:** Drafts hotfix or executes rollback commands.
- **Verifier:** Runs post-deployment health checks before resolving incident.

---

## 2. Deployment Rollback Procedure

### Phase A: Immediate Emergency Pause (Circuit Breaker)
If the issue affects money movement or contract state, pause the contracts immediately.

1. **Pause YieldVault Contracts:**
   ```bash
   # Run pause script or call pause method via CLI
   cargo run -p scripts -- bin/pause_vault --network mainnet
