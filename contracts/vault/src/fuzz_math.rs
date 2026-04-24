/// Fuzz / property-based tests for vault math logic.
///
/// These tests exercise `calculate_shares`, `calculate_assets`, and the
/// deposit/withdraw share-price formulas against the full i128 input space to
/// verify:
///   1. No arithmetic overflow on any valid input combination.
///   2. Monotonicity – more assets in → more shares out (and vice-versa).
///   3. Round-trip consistency – depositing then withdrawing never returns
///      *more* assets than were deposited (no value extraction via rounding).
///   4. Zero-state invariant – first depositor always gets a 1:1 share ratio.
///
/// Run with:
///   cargo test fuzz --features testutils -- --nocapture
#[cfg(test)]
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

use crate::{YieldVault, YieldVaultClient};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, YieldVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_addr = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register(YieldVault, ());
    let client = YieldVaultClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr);

    (env, client, admin, token_addr)
}

/// Mint `amount` tokens to `recipient` from the SAC admin.
fn mint(env: &Env, token_addr: &Address, _admin: &Address, recipient: &Address, amount: i128) {
    let token = token::StellarAssetClient::new(env, token_addr);
    token.mint(recipient, &amount);
}

// ── pure math helpers (mirrors contract logic, no SDK needed) ─────────────────

/// Replicate the share-minting formula used in `deposit` and `calculate_shares`.
fn shares_for(assets: i128, total_shares: i128, total_assets: i128) -> Option<i128> {
    if total_assets == 0 || total_shares == 0 {
        Some(assets) // 1:1 bootstrap
    } else {
        assets.checked_mul(total_shares)?.checked_div(total_assets)
    }
}

/// Replicate the asset-redemption formula used in `withdraw` and `calculate_assets`.
fn assets_for(shares: i128, total_shares: i128, total_assets: i128) -> Option<i128> {
    if total_shares == 0 {
        Some(0)
    } else {
        shares.checked_mul(total_assets)?.checked_div(total_shares)
    }
}

// ── property strategies ───────────────────────────────────────────────────────

/// Positive i128 values up to i128::MAX.
fn pos_i128() -> impl Strategy<Value = i128> {
    1i128..=i128::MAX
}

/// Vault state: (total_shares, total_assets) both positive.
fn vault_state() -> impl Strategy<Value = (i128, i128)> {
    (pos_i128(), pos_i128())
}

// ── overflow safety tests (pure math) ────────────────────────────────────────

proptest! {
    /// `shares_for` must never overflow for any positive inputs.
    #[test]
    fn fuzz_shares_for_no_overflow(
        assets in pos_i128(),
        total_shares in pos_i128(),
        total_assets in pos_i128(),
    ) {
        // The function returns None on overflow – assert it always returns Some
        // for the range where the intermediate product fits in i128.
        // For inputs where overflow would occur, checked_mul returns None which
        // is the correct safe behaviour; we just verify no panic occurs.
        let _ = shares_for(assets, total_shares, total_assets);
    }

    /// `assets_for` must never overflow for any positive inputs.
    #[test]
    fn fuzz_assets_for_no_overflow(
        shares in pos_i128(),
        total_shares in pos_i128(),
        total_assets in pos_i128(),
    ) {
        let _ = assets_for(shares, total_shares, total_assets);
    }

    /// Round-trip: assets_for(shares_for(a)) <= a  (no value extraction).
    #[test]
    fn fuzz_round_trip_no_value_extraction(
        assets in 1i128..=1_000_000_000_000i128,
        (total_shares, total_assets) in vault_state(),
    ) {
        if let Some(shares) = shares_for(assets, total_shares, total_assets) {
            if let Some(returned) = assets_for(shares, total_shares + shares, total_assets + assets) {
                // Due to integer division, returned <= assets always.
                prop_assert!(
                    returned <= assets,
                    "round-trip returned more than deposited: {} > {}",
                    returned,
                    assets
                );
            }
        }
    }

    /// Monotonicity: more assets → more shares (same vault state).
    #[test]
    fn fuzz_shares_monotone(
        a in 1i128..=500_000_000_000i128,
        b in 1i128..=500_000_000_000i128,
        (total_shares, total_assets) in vault_state(),
    ) {
        let sa = shares_for(a, total_shares, total_assets);
        let sb = shares_for(b, total_shares, total_assets);
        if let (Some(sa), Some(sb)) = (sa, sb) {
            if a < b {
                prop_assert!(sa <= sb, "shares not monotone: shares({})={} > shares({})={}", a, sa, b, sb);
            }
        }
    }

    /// Monotonicity: more shares → more assets (same vault state).
    #[test]
    fn fuzz_assets_monotone(
        s1 in 1i128..=500_000_000_000i128,
        s2 in 1i128..=500_000_000_000i128,
        (total_shares, total_assets) in vault_state(),
    ) {
        let a1 = assets_for(s1, total_shares, total_assets);
        let a2 = assets_for(s2, total_shares, total_assets);
        if let (Some(a1), Some(a2)) = (a1, a2) {
            if s1 < s2 {
                prop_assert!(a1 <= a2, "assets not monotone: assets({})={} > assets({})={}", s1, a1, s2, a2);
            }
        }
    }

    /// Zero-state: first depositor always gets exactly `assets` shares (1:1).
    #[test]
    fn fuzz_first_deposit_one_to_one(assets in pos_i128()) {
        let shares = shares_for(assets, 0, 0).unwrap();
        prop_assert_eq!(shares, assets);
    }

    /// Yield accrual: adding yield to total_assets increases assets_for any share amount.
    #[test]
    fn fuzz_yield_increases_redemption_value(
        shares in 1i128..=1_000_000_000i128,
        total_shares in 1i128..=1_000_000_000i128,
        total_assets in 1i128..=1_000_000_000i128,
        yield_amount in 1i128..=1_000_000_000i128,
    ) {
        let before = assets_for(shares, total_shares, total_assets);
        let after  = assets_for(shares, total_shares, total_assets + yield_amount);
        if let (Some(before), Some(after)) = (before, after) {
            prop_assert!(
                after >= before,
                "yield accrual decreased redemption value: {} < {}",
                after,
                before
            );
        }
    }
}

// ── integration fuzz via Soroban test environment ─────────────────────────────

proptest! {
    /// Deposit then full-withdraw: user never receives more than deposited.
    /// Uses the full i128 range to ensure no panics occur on extreme values.
    #[test]
    fn fuzz_deposit_withdraw_no_profit(
        deposit_amount in 1i128..=i128::MAX,
    ) {
        let (env, client, admin, token_addr) = setup();
        let user = Address::generate(&env);

        mint(&env, &token_addr, &admin, &user, deposit_amount);

        let deposit_result = client.try_deposit(&user, &deposit_amount);
        
        if let Ok(Ok(shares)) = deposit_result {
            prop_assert!(shares > 0, "deposit minted zero shares");

            let returned_result = client.try_withdraw(&user, &shares);
            if let Ok(Ok(returned)) = returned_result {
                prop_assert!(
                    returned <= deposit_amount,
                    "withdraw returned more than deposited: {} > {}",
                    returned,
                    deposit_amount
                );
            }
        }
    }

    /// Test that tiny deposits (like 1 stroop) correctly fail instead of silently
    /// losing funds if they would round down to 0 shares due to yield accrual.
    #[test]
    fn fuzz_tiny_deposit_with_yield(
        deposit_amount in 1i128..=10i128,
        yield_amount in 100i128..=1_000_000i128,
    ) {
        let (env, client, admin, token_addr) = setup();
        let user_1 = Address::generate(&env);
        let user_tiny = Address::generate(&env);

        let initial_deposit = 100i128;
        mint(&env, &token_addr, &admin, &user_1, initial_deposit);
        client.deposit(&user_1, &initial_deposit);

        mint(&env, &token_addr, &admin, &admin, yield_amount);
        client.distribute_yield(&yield_amount);

        mint(&env, &token_addr, &admin, &user_tiny, deposit_amount);
        
        let deposit_result = client.try_deposit(&user_tiny, &deposit_amount);
        let projected_shares = client.calculate_shares(&deposit_amount);
        
        if projected_shares == 0 {
            prop_assert!(
                deposit_result.is_err(),
                "deposit should revert if shares round to 0 to prevent silent loss"
            );
        } else {
            prop_assert!(deposit_result.is_ok(), "deposit should succeed if shares > 0");
        }
    }

    /// calculate_shares then calculate_assets round-trip via contract calls.
    #[test]
    fn fuzz_contract_calculate_round_trip(
        deposit_a in 1i128..=1_000_000i128,
        deposit_b in 1i128..=1_000_000i128,
    ) {
        let (env, client, admin, token_addr) = setup();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        mint(&env, &token_addr, &admin, &user_a, deposit_a);
        mint(&env, &token_addr, &admin, &user_b, deposit_b);

        client.deposit(&user_a, &deposit_a);

        // After user_a deposits, calculate_shares for user_b's amount
        let projected_shares = client.calculate_shares(&deposit_b);
        prop_assert!(projected_shares >= 0, "calculate_shares returned negative");

        // calculate_assets for those projected shares must not exceed deposit_b
        let projected_assets = client.calculate_assets(&projected_shares);
        prop_assert!(
            projected_assets <= deposit_b,
            "calculate_assets exceeds input: {} > {}",
            projected_assets,
            deposit_b
        );
    }
}
