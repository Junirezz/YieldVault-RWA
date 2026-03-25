#!/usr/bin/env bash
set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${SOROBAN_IDENTITY:-default}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/deployments/contracts.${NETWORK}.json"

if [[ "$NETWORK" != "testnet" && "$NETWORK" != "futurenet" ]]; then
  echo "Usage: $0 [testnet|futurenet]"
  exit 1
fi

cd "$ROOT_DIR"

echo "Building WASM artifacts..."
cargo build -p vault --target wasm32-unknown-unknown --release
cargo build -p mock-strategy --target wasm32-unknown-unknown --release

VAULT_WASM="$ROOT_DIR/target/wasm32-unknown-unknown/release/vault.wasm"
STRATEGY_WASM="$ROOT_DIR/target/wasm32-unknown-unknown/release/mock_strategy.wasm"

echo "Deploying vault to $NETWORK..."
VAULT_ID=$(soroban contract deploy \
  --network "$NETWORK" \
  --source "$IDENTITY" \
  --wasm "$VAULT_WASM")

echo "Deploying mock strategy to $NETWORK..."
STRATEGY_ID=$(soroban contract deploy \
  --network "$NETWORK" \
  --source "$IDENTITY" \
  --wasm "$STRATEGY_WASM")

cat > "$OUT_FILE" <<JSON
{
  "network": "$NETWORK",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "identity": "$IDENTITY",
  "contracts": {
    "vault": "$VAULT_ID",
    "mock_korean_strategy": "$STRATEGY_ID"
  }
}
JSON

echo "Deployment complete."
echo "Vault: $VAULT_ID"
echo "Mock Strategy: $STRATEGY_ID"
echo "Saved to $OUT_FILE"
