# Cross-Chain Bridge Compatibility Layer

## Overview

The bridge compatibility layer provides a generic interface for cross-chain USDC transfers via bridge providers (Wormhole, LayerZero, etc.) on Stellar/Soroban.

## Architecture

```
User -> BridgeCompat Contract -> Bridge Provider -> Destination Chain
              \-> Fallback Provider (on primary failure)
```

### Contract: `bridge-compat`

Located at `contracts/bridge-compat/`.

## Adding a New Bridge Provider

### Step 1: Implement the Provider Endpoint

Create a Soroban contract that implements the bridge interaction logic:

```rust
// Example: contracts/my-bridge-endpoint/src/lib.rs
#[contract]
pub struct MyBridgeEndpoint;

#[contractimpl]
impl MyBridgeEndpoint {
    pub fn send(env: Env, token: Address, amount: i128, recipient: Bytes, dest_chain: u32) {
        // Bridge-specific logic here
    }

    pub fn estimate_fee(env: Env, amount: i128, dest_chain: u32) -> i128 {
        // Return estimated fee in token units
    }

    pub fn supported_chains(env: Env) -> Vec<u32> {
        // Return list of supported destination chain IDs
    }
}
```

### Step 2: Register the Provider

```rust
// Via BridgeCompat contract
bridge_compat.register_provider(
    env,
    String::from_str(&env, "MyBridge"),          // name
    BridgeProviderKind::Custom,                    // kind
    my_bridge_endpoint_address,                    // endpoint contract
    100,                                           // fee_bps (1%)
    500_000_000_000,                               // max_transfer (500K USDC)
    Vec::from_array(&env, &[1, 2, 3]),            // supported chain IDs
);
```

### Step 3: Configure as Default (Optional)

```rust
bridge_compat.set_default_provider(env, provider_id);
```

## Supported Bridge Providers

| Provider | Kind | Stellar Support | Status |
|----------|------|-----------------|--------|
| Wormhole | BridgeProviderKind::Wormhole | Experimental | Ready for testnet |
| LayerZero | BridgeProviderKind::LayerZero | Experimental | Ready for testnet |
| Custom | BridgeProviderKind::Custom | Via adapter | Flexible |

## Chain IDs

Chain identifiers follow the Wormhole convention:

| Chain | ID |
|-------|----|
| Stellar | 0 |
| Ethereum | 2 |
| Solana | 1 |
| Polygon | 5 |
| BSC | 4 |
| Avalanche | 6 |
| Arbitrum | 23 |

## Transfer Flow

1. **Estimate**: Call `estimate_transfer()` to get fee and receive amount
2. **Initiate**: Call `transfer_out()` with sender auth
3. **Bridge**: The bridge endpoint processes the cross-chain transfer
4. **Confirm**: Admin or relayer calls `confirm_transfer()` on completion
5. **Refund**: If bridge fails, admin calls `fail_transfer()` to refund

## Fallback Handling

When the primary bridge provider fails:

1. The transfer status is set to `Failed`
2. Admin initiates refund via `fail_transfer()`
3. Tokens are returned to the sender
4. Optionally, retry with a different provider

## Transfer Limits

Configurable per bridge instance:

- **Per-transfer limit**: Maximum amount per single transfer
- **Epoch volume limit**: Maximum total volume within a time window
- **Epoch duration**: Time window for volume tracking (default 24h)

## Testnet Deployment

```bash
# Deploy bridge-compat contract
soroban contract deploy \
  --wasm contracts/bridge-compat/target/wasm32-unknown-unknown/release/bridge_compat.wasm \
  --network testnet

# Initialize
soroban contract invoke \
  --id <CONTRACT_ID> \
  --fn initialize \
  --arg <ADMIN_ADDRESS> \
  --arg <USDC_TOKEN_ADDRESS> \
  --network testnet

# Register a provider
soroban contract invoke \
  --id <CONTRACT_ID> \
  --fn register_provider \
  --arg "Wormhole" \
  --arg 0 \
  --arg <ENDPOINT_ADDRESS> \
  --arg 50 \
  --arg 1000000000000 \
  --arg '[1,2,3]' \
  --network testnet
```

## Security Considerations

- Admin-only provider registration and configuration
- Transfer limits prevent excessive capital movement
- Nonce-based replay protection
- Token balance checks before transfer
- Epoch-based volume tracking prevents flash-loan attacks

## Future Enhancements

1. **Relayer network**: Decentralized relayers for automatic confirmation
2. **Oracle integration**: Price feeds for cross-chain value parity
3. **Multi-hop routing**: Route through intermediate chains for better rates
4. **Batch transfers**: Aggregate multiple small transfers
5. **Automatic failover**: Switch providers without admin intervention
