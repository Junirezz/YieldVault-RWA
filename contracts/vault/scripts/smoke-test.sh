#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# smoke-test.sh — Deploy vault WASM to Stellar testnet and run a smoke test.
#
# Required environment variables (set by the caller / CI step):
#   TESTNET_SECRET_KEY     — Stellar secret key (S... format) for the deployer account
#   TESTNET_TOKEN_ADDRESS  — Stellar contract address (C... format) for the token
#   GIT_SHA                — Git commit SHA to embed in deployment.json
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 1. Secret validation guard
#    Fail fast before any network operation if required secrets are absent.
# ---------------------------------------------------------------------------
if [ -z "${TESTNET_SECRET_KEY:-}" ]; then
  echo "ERROR: TESTNET_SECRET_KEY secret is not set or is empty" >&2
  exit 1
fi

if [ -z "${TESTNET_TOKEN_ADDRESS:-}" ]; then
  echo "ERROR: TESTNET_TOKEN_ADDRESS secret is not set or is empty" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Add deployer identity
#    The secret key is read from the environment variable — it is never
#    interpolated directly into the command string to prevent log exposure.
# ---------------------------------------------------------------------------
stellar keys add ci-deployer --secret-key "$TESTNET_SECRET_KEY"

# ---------------------------------------------------------------------------
# 3. Deploy vault WASM
# ---------------------------------------------------------------------------
CONTRACT_ID=$(stellar contract deploy \
  --wasm artifacts/wasm/vault.wasm \
  --source ci-deployer \
  --network testnet)

echo "Deployed contract: $CONTRACT_ID"

# ---------------------------------------------------------------------------
# 4. Initialize the contract
# ---------------------------------------------------------------------------
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source ci-deployer \
  --network testnet \
  -- initialize \
  --admin "$(stellar keys address ci-deployer)" \
  --token "$TESTNET_TOKEN_ADDRESS"

# ---------------------------------------------------------------------------
# 5. Smoke test: deposit
# ---------------------------------------------------------------------------
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source ci-deployer \
  --network testnet \
  -- deposit \
  --user "$(stellar keys address ci-deployer)" \
  --amount 1000000

# ---------------------------------------------------------------------------
# 6. Smoke test: balance check
# ---------------------------------------------------------------------------
BALANCE=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source ci-deployer \
  --network testnet \
  -- balance \
  --user "$(stellar keys address ci-deployer)")

if [ "$BALANCE" -le 0 ]; then
  echo "ERROR: Expected balance > 0, got: $BALANCE" >&2
  exit 1
fi

echo "Balance check passed: $BALANCE"

# ---------------------------------------------------------------------------
# 7. Write deployment.json
#    Contains only contract_id and git_sha — no secret material.
# ---------------------------------------------------------------------------
cat > deployment.json <<EOF
{
  "contract_id": "$CONTRACT_ID",
  "git_sha": "${GIT_SHA:-}"
}
EOF

echo "deployment.json written successfully"
