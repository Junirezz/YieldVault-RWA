# Feasibility Study: ERC-404 Token Support

**Issue:** #1225  
**Status:** Research Complete  
**Date:** 2026-08-26  

## Executive Summary

ERC-404 is a hybrid token standard on EVM chains that combines ERC-20 fungibility with ERC-721 NFT characteristics. This study evaluates whether YieldVault-RWA should support ERC-404-style tokens on Stellar/Soroban.

**Recommendation:** Implement a Soroban-native semi-fungible token (SFT) adapter rather than direct ERC-404 port, as ERC-404 is EVM-specific and Stellar has its own token primitives.

## Background

### What is ERC-404?

ERC-404 is an EVM token standard that creates a 1:1 binding between fungible tokens (ERC-20) and non-fungible tokens (ERC-721):

- Holding whole tokens = holding the associated NFT
- Transferring fractional amounts = burning/minting NFTs dynamically
- No separate "claim" step — NFT ownership automatically tracks token balance
- Enables fractional NFT trading with ERC-20 liquidity

### Key Properties

| Property | ERC-404 (EVM) | Soroban Equivalent |
|----------|---------------|-------------------|
| Fungible base | ERC-20 | Stellar Asset Contract (SAC) |
| Non-fungible component | ERC-721 | Custom NFT contract |
| Binding mechanism | Contract-level | Custom adapter contract |
| Fractional ownership | Native | Requires accounting layer |
| Transfer hooks | `transfer()` override | Soroban `transfer()` + custom logic |

## Analysis: Stellar/Soroban Compatibility

### Current Vault Architecture

YieldVault-RWA uses:
- **Underlying asset:** USDC (Stellar Asset Contract / SAC)
- **Vault shares:** Internal accounting via `ShareBalance` storage keys (not a minted token)
- **Token interaction:** `soroban_sdk::token::Client` for SAC transfers

The vault currently supports:
- ERC-4626-style deposits (deposit USDC, get internal shares)
- Strategy allocation (invest USDC in yield strategies)
- No external token contract for vault shares

### ERC-404 on Stellar: Challenges

#### 1. No Native ERC-404 Equivalent
Stellar does not have a built-in semi-fungible token standard. The closest equivalents are:
- **Stellar Asset Contracts (SAC):** Fungible only (like ERC-20)
- **Custom Soroban NFT contracts:** Non-fungible only (like ERC-721)
- **Separate accounting:** Track fungible + non-fungible separately

#### 2. Token Transfer Hooks
ERC-404 overrides `transfer()` to automatically burn/mint NFTs. On Soroban:
- SAC `transfer()` cannot be overridden (it's a protocol-level contract)
- Custom token contracts can implement hooks, but are not SAC-compatible
- Would require a wrapper contract around the base asset

#### 3. Fractional Share Implications
If vault shares were ERC-404-style:
- Users holding fractional shares (e.g., 1.5 yvUSDC) would NOT get the associated NFT
- Only whole-number holders get the NFT component
- This creates a "dead zone" for fractional holders
- Incompatible with the vault's current fractional share model (shares are always fractional)

#### 4. Gas/Compute Costs
ERC-404's automatic NFT minting on every whole-number boundary crossing:
- Doubles compute cost per transfer (SAC transfer + NFT mint/burn)
- Increases storage costs (NFT metadata storage)
- Soroban's compute budget may make this expensive

### Potential Implementation Path

If ERC-404 support is desired, the recommended approach is a **Soroban SFT Adapter**:

```
┌─────────────────────────────────────────┐
│           SFT Adapter Contract          │
│  ┌──────────┐    ┌──────────────────┐  │
│  │  SAC      │    │  NFT Contract    │  │
│  │ (USDC)   │    │  (Fractional     │  │
│  │          │    │   ownership)     │  │
│  └──────────┘    └──────────────────┘  │
└─────────────────────────────────────────┘
```

The adapter would:
1. Accept deposits of the base token (USDC)
2. Track fractional ownership internally
3. Mint NFTs when users reach whole-number thresholds
4. Burn NFTs when users transfer below thresholds
5. Maintain a claim/redeem mechanism for NFT ↔ token conversion

### Migration Path

For YieldVault-RWA specifically:

1. **Phase 1 (Current):** Internal share accounting (no external token)
2. **Phase 2 (Optional):** Wrapped vault share token (yvUSDC as a real Soroban token)
3. **Phase 3 (Optional):** SFT adapter for yvUSDC with NFT components
4. **Phase 4 (Future):** Cross-chain ERC-404 via bridge compatibility layer

## Risks and Benefits

### Benefits
- **Enhanced UX:** Users could hold vault positions as tradeable NFTs
- **Composability:** NFT-based vault shares could integrate with Soroban NFT marketplaces
- **New use cases:** Collateralized vault positions, fractional position trading
- **Marketing:** ERC-404 compatibility signals innovation to the community

### Risks
- **Complexity:** Adds a significant new contract and storage model
- **Security surface:** NFT minting/burning logic creates new attack vectors
- **Gas costs:** Double compute for every transfer operation
- **Incompatibility:** Current fractional share model directly conflicts with ERC-404 whole-number binding
- **Maintenance burden:** Two token models to maintain (internal + SFT)

## Recommendation

### Do NOT implement ERC-404 directly
- ERC-404 is an EVM standard; Stellar has different primitives
- The fractional share model is incompatible with whole-number NFT binding
- The complexity outweighs the benefits for an RWA vault

### DO consider a wrapped vault token
If enhanced composability is desired:
1. Create a `yvUSDC` Soroban token contract (standard SAC)
2. Users wrap their internal shares into the tradeable token
3. This is simpler than ERC-404 and compatible with Stellar ecosystem

### DO track ERC-404 ecosystem evolution
- Monitor Stellar Improvement Proposals (SEPs) for SFT standards
- Watch for Soroban token extensions that could enable SFT patterns
- Re-evaluate if a Soroban-native SFT standard emerges

## Appendix: ERC-404 Reference

### ERC-404 Specification (EVM)
- Token balance tracks both fungible and non-fungible components
- `transfer()` automatically burns/mints NFTs at whole-number boundaries
- `totalSupply()` returns fungible token supply
- NFT ownership is a derivative of token balance, not independent

### Soroban Token Standards
- **SAC (Stellar Asset Contract):** Native asset wrapping, fungible only
- **SEP-41:** Token interface (similar to ERC-20)
- **Custom NFT contracts:** No standard yet; typically use metadata + ownership tracking

### Related Work
- **Fractional.art (EVM):** ERC-20 backed by locked NFTs (inverse of ERC-404)
- **Charged Particles (EVM):** Multi-token NFTs with yield
- **Soroban NFTs:** Community-driven, no official standard yet
