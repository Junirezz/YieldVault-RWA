//! Share-price math invariants shared by proptest and libFuzzer.

use crate::{try_assets_to_shares, try_shares_to_assets, MathError};

fn shares_for(assets: i128, total_shares: i128, total_assets: i128) -> Result<i128, MathError> {
    try_assets_to_shares(assets, total_shares, total_assets)
}

fn assets_for(shares: i128, total_shares: i128, total_assets: i128) -> Result<i128, MathError> {
    try_shares_to_assets(shares, total_shares, total_assets)
}

/// Real vaults are either empty or have both shares and assets outstanding.
fn is_valid_vault_state(total_shares: i128, total_assets: i128) -> bool {
    (total_shares == 0 && total_assets == 0) || (total_shares > 0 && total_assets > 0)
}

/// Decode a little-endian `i128` from eight bytes (any value, including zero).
pub fn i128_from_le_bytes(bytes: &[u8]) -> Option<i128> {
    if bytes.len() < 8 {
        return None;
    }
    let mut arr = [0u8; 16];
    arr[..8].copy_from_slice(&bytes[..8]);
    Some(i128::from_le_bytes(arr))
}

/// Decode a strictly positive `i128` from eight little-endian bytes.
pub fn positive_i128_from_le_bytes(bytes: &[u8]) -> Option<i128> {
    let value = i128_from_le_bytes(bytes)?;
    if value > 0 {
        Some(value)
    } else {
        None
    }
}

/// Decode four `i128` values from a 32-byte little-endian payload.
pub fn decode_vault_math_input(data: &[u8]) -> Option<(i128, i128, i128, i128)> {
    if data.len() != 32 {
        return None;
    }
    let assets = positive_i128_from_le_bytes(&data[0..8])?;
    let total_shares = i128_from_le_bytes(&data[8..16])?;
    let total_assets = i128_from_le_bytes(&data[16..24])?;
    let yield_amount = positive_i128_from_le_bytes(&data[24..32])?;
    if total_shares < 0 || total_assets < 0 {
        return None;
    }
    Some((assets, total_shares, total_assets, yield_amount))
}

/// Encode a 32-byte corpus seed from vault math parameters.
pub fn encode_vault_math_input(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
    yield_amount: i128,
) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[0..8].copy_from_slice(&assets.to_le_bytes()[..8]);
    out[8..16].copy_from_slice(&total_shares.to_le_bytes()[..8]);
    out[16..24].copy_from_slice(&total_assets.to_le_bytes()[..8]);
    out[24..32].copy_from_slice(&yield_amount.to_le_bytes()[..8]);
    out
}

/// Exercise the pure share-price invariants from `fuzz_math.rs`.
pub fn assert_share_price_invariants(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
    yield_amount: i128,
) {
    if !is_valid_vault_state(total_shares, total_assets) {
        return;
    }

    let _ = shares_for(assets, total_shares, total_assets);
    let _ = assets_for(assets.min(total_shares.max(1)), total_shares, total_assets);

    if total_shares == 0 && total_assets == 0 {
        if let Ok(shares) = shares_for(assets, 0, 0) {
            assert_eq!(
                shares, assets,
                "first deposit must be 1:1: assets={assets} shares={shares}"
            );
        }
    }

    if let Ok(shares) = shares_for(assets, total_shares, total_assets) {
        if let (Some(new_shares), Some(new_assets)) = (
            total_shares.checked_add(shares),
            total_assets.checked_add(assets),
        ) {
            if let Ok(returned) = assets_for(shares, new_shares, new_assets) {
                assert!(
                    returned <= assets,
                    "round-trip returned more than deposited: {returned} > {assets}"
                );
            }
        }
    }

    let probe_shares = assets.min(total_shares.max(1));
    let before = assets_for(probe_shares, total_shares, total_assets).ok();
    if let Some(after_total_assets) = total_assets.checked_add(yield_amount) {
        let after = assets_for(probe_shares, total_shares, after_total_assets).ok();
        if let (Some(before), Some(after)) = (before, after) {
            assert!(
                after >= before,
                "yield accrual decreased redemption value: {after} < {before}"
            );
        }
    }

    // Invariant: Share price monotonicity under positive yield accrual
    if total_shares > 0 && total_assets > 0 {
        const SCALE: i128 = 1_000_000_000_000_000_000;
        let price_before = total_assets.saturating_mul(SCALE) / total_shares;
        if let Some(after_assets) = total_assets.checked_add(yield_amount) {
            let price_after = after_assets.saturating_mul(SCALE) / total_shares;
            assert!(
                price_after >= price_before,
                "share price non-monotonic under yield accrual: {price_after} < {price_before}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_round_trip() {
        let seed = encode_vault_math_input(300, 1000, 1500, 50);
        let decoded = decode_vault_math_input(&seed).expect("decode");
        assert_eq!(decoded, (300, 1000, 1500, 50));
    }

    #[test]
    fn bootstrap_invariant_holds() {
        assert_share_price_invariants(1000, 0, 0, 1);
    }
}
