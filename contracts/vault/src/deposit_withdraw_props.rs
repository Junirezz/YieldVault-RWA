/// Property-based tests for deposit/withdraw math invariants (Issue #962).
///
/// These tests complement the existing `fuzz_math.rs` tests by covering
/// higher-level vault invariants that span multiple operations:
///
///   1. Multi-user deposit: sum(shares) == total_shares and total_assets == sum(deposits).
///   2. Partial withdrawal: user's remaining shares are consistent with vault share price.
///   3. Share price monotonicity: yield accrual can only increase share price.
///   4. Fee extraction: claim_fees reduces total_assets by exactly the fee amount.
///   5. Batch deposit consistency: same total shares as N individual deposits.
///   6. Withdrawal cooldown enforcement: withdraw inside cooldown window → error.
///
/// Run with:
///   cargo test deposit_withdraw_props -- --nocapture
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

fn mint(env: &Env, token_addr: &Address, recipient: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token_addr).mint(recipient, &amount);
}

// ── Property 1: multi-user deposit invariants ─────────────────────────────────

proptest! {
    #![proptest_config(proptest::test_runner::Config {
        cases: 500,
        ..proptest::test_runner::Config::default()
    })]

    /// After two users each deposit, total_shares == sum of their minted shares
    /// and total_assets == sum of their deposits (no yield, no fees).
    #[test]
    fn prop_two_user_deposit_share_sum(
        amount_a in 1i128..=1_000_000i128,
        amount_b in 1i128..=1_000_000i128,
    ) {
        let (env, client, _admin, token) = setup();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        mint(&env, &token, &user_a, amount_a);
        mint(&env, &token, &user_b, amount_b);

        let shares_a = match client.try_deposit(&user_a, &amount_a) {
            Ok(Ok(s)) => s,
            _ => return Ok(()), // zero-share edge case: skip
        };
        let shares_b = match client.try_deposit(&user_b, &amount_b) {
            Ok(Ok(s)) => s,
            _ => return Ok(()),
        };

        let total_shares = client.total_shares();
        prop_assert_eq!(
            total_shares,
            shares_a + shares_b,
            "total_shares must equal sum of minted shares"
        );

        // With no yield or fees, total_assets == amount_a + amount_b
        // (dust may be rounded into treasury, so total_assets <= sum)
        let total_assets = client.total_assets();
        prop_assert!(
            total_assets <= amount_a + amount_b,
            "total_assets must not exceed sum of deposits"
        );
        prop_assert!(
            total_assets >= shares_a + shares_b - 2,
            "total_assets must approximately equal effective deposits"
        );
    }

    /// Share balances sum to total_shares for three users.
    #[test]
    fn prop_three_user_share_sum(
        a in 100i128..=100_000i128,
        b in 100i128..=100_000i128,
        c in 100i128..=100_000i128,
    ) {
        let (env, client, _admin, token) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        let u3 = Address::generate(&env);

        mint(&env, &token, &u1, a);
        mint(&env, &token, &u2, b);
        mint(&env, &token, &u3, c);

        let s1 = client.try_deposit(&u1, &a).ok().and_then(|r| r.ok()).unwrap_or(0);
        let s2 = client.try_deposit(&u2, &b).ok().and_then(|r| r.ok()).unwrap_or(0);
        let s3 = client.try_deposit(&u3, &c).ok().and_then(|r| r.ok()).unwrap_or(0);

        let bal1 = client.balance(&u1);
        let bal2 = client.balance(&u2);
        let bal3 = client.balance(&u3);

        prop_assert_eq!(bal1, s1, "user1 balance must equal minted shares");
        prop_assert_eq!(bal2, s2, "user2 balance must equal minted shares");
        prop_assert_eq!(bal3, s3, "user3 balance must equal minted shares");

        prop_assert_eq!(
            bal1 + bal2 + bal3,
            client.total_shares(),
            "sum of user balances must equal total_shares"
        );
    }
}

// ── Property 2: partial withdrawal correctness ───────────────────────────────

proptest! {
    /// After a partial withdrawal, remaining shares must exactly reflect what
    /// was kept, and never go negative.
    #[test]
    fn prop_partial_withdrawal_shares_consistent(
        deposit_amount in 1_000i128..=1_000_000i128,
        withdraw_fraction in 1u32..=99u32, // 1%–99% of shares
    ) {
        let (env, client, _admin, token) = setup();
        let user = Address::generate(&env);

        mint(&env, &token, &user, deposit_amount);
        let total_shares = match client.try_deposit(&user, &deposit_amount) {
            Ok(Ok(s)) if s > 0 => s,
            _ => return Ok(()),
        };

        let shares_to_withdraw = (total_shares * withdraw_fraction as i128) / 100;
        if shares_to_withdraw == 0 {
            return Ok(());
        }

        client.withdraw(&user, &shares_to_withdraw);

        let remaining = client.balance(&user);
        let expected_remaining = total_shares - shares_to_withdraw;

        prop_assert_eq!(
            remaining,
            expected_remaining,
            "remaining shares must equal total - withdrawn"
        );
        prop_assert!(remaining >= 0, "share balance must never go negative");
    }
}

// ── Property 3: share price monotonicity under yield ─────────────────────────

proptest! {
    /// Accruing yield can only increase or maintain the share price, never decrease it.
    #[test]
    fn prop_yield_accrual_monotone_share_price(
        deposit_amount in 1_000i128..=1_000_000i128,
        yield_amount in 1i128..=1_000_000i128,
    ) {
        let (env, client, admin, token) = setup();
        let user = Address::generate(&env);

        mint(&env, &token, &user, deposit_amount);
        match client.try_deposit(&user, &deposit_amount) {
            Ok(Ok(s)) if s > 0 => s,
            _ => return Ok(()),
        };

        let price_before = client.share_price();

        // Accrue yield
        mint(&env, &token, &admin, yield_amount);
        client.accrue_yield(&yield_amount);

        let price_after = client.share_price();

        prop_assert!(
            price_after >= price_before,
            "yield accrual must not decrease share price: before={} after={}",
            price_before,
            price_after
        );
    }

    /// Share price must be positive after any deposit.
    #[test]
    fn prop_share_price_positive_after_deposit(
        deposit_amount in 1i128..=1_000_000i128,
    ) {
        let (env, client, _admin, token) = setup();
        let user = Address::generate(&env);

        mint(&env, &token, &user, deposit_amount);
        match client.try_deposit(&user, &deposit_amount) {
            Ok(Ok(s)) if s > 0 => s,
            _ => return Ok(()),
        };

        prop_assert!(
            client.share_price() > 0,
            "share price must be positive after a deposit"
        );
    }
}

// ── Property 4: fee extraction invariant ─────────────────────────────────────

proptest! {
    /// After claim_fees, treasury_balance resets to zero and the claimed amount
    /// came only from accrued fees (not from principal).
    #[test]
    fn prop_fee_extraction_does_not_touch_principal(
        deposit_amount in 10_000i128..=1_000_000i128,
        yield_amount in 1_000i128..=100_000i128,
        fee_bps in 1i128..=1_000i128, // 0.01%–10%
    ) {
        let (env, client, admin, token) = setup();
        let user = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Fee bps and treasury are behind the sensitive-parameter timelock
        // (#969): queue the change, then execute it immediately — the default
        // delay is zero until an admin configures one.
        client.queue_fee_bps_change(&fee_bps);
        client.execute_fee_bps_change();
        client.queue_treasury_change(&treasury);
        client.execute_treasury_change();

        mint(&env, &token, &user, deposit_amount);
        match client.try_deposit(&user, &deposit_amount) {
            Ok(Ok(s)) if s > 0 => s,
            _ => return Ok(()),
        };

        let assets_after_deposit = client.total_assets();

        // Accrue yield
        mint(&env, &token, &admin, yield_amount);
        client.accrue_yield(&yield_amount);

        let fee_balance = client.treasury_balance();
        prop_assert!(
            fee_balance >= 0,
            "treasury balance must not go negative"
        );

        let expected_fee = (yield_amount * fee_bps) / 10_000;
        prop_assert!(
            fee_balance <= expected_fee + 1, // +1 for rounding
            "fee must not exceed calculated fee: fee_balance={} expected_fee={}",
            fee_balance,
            expected_fee
        );

        // After claiming fees, treasury_balance resets to 0
        if fee_balance > 0 {
            client.claim_fees();
            prop_assert_eq!(
                client.treasury_balance(),
                0,
                "treasury balance must reset to 0 after claim_fees"
            );
        }

        // The user's principal (assets_after_deposit) must not have been eroded
        let assets_now = client.total_assets();
        let net_yield = yield_amount - fee_balance;
        prop_assert!(
            assets_now >= assets_after_deposit + net_yield - 1,
            "principal+net_yield must be preserved: assets_now={} expected>={}",
            assets_now,
            assets_after_deposit + net_yield - 1
        );
    }
}

// ── Property 5: batch deposit vs individual deposit consistency ───────────────

proptest! {
    #![proptest_config(proptest::test_runner::Config {
        cases: 200,
        ..proptest::test_runner::Config::default()
    })]

    /// A batch deposit of two users produces the same total shares and total_assets
    /// as two individual deposits of the same amounts into an equivalent vault.
    #[test]
    fn prop_batch_deposit_matches_individual_deposits(
        amount_a in 100i128..=500_000i128,
        amount_b in 100i128..=500_000i128,
    ) {
        use crate::DepositEntry;
        use soroban_sdk::Vec;

        // ── Vault A: individual deposits ──────────────────────────────────────
        let (env_a, client_a, _admin_a, token_a) = setup();
        let user_a1 = Address::generate(&env_a);
        let user_a2 = Address::generate(&env_a);

        mint(&env_a, &token_a, &user_a1, amount_a);
        mint(&env_a, &token_a, &user_a2, amount_b);

        let sa1 = client_a.try_deposit(&user_a1, &amount_a).ok().and_then(|r| r.ok()).unwrap_or(0);
        let sa2 = client_a.try_deposit(&user_a2, &amount_b).ok().and_then(|r| r.ok()).unwrap_or(0);

        let total_shares_individual = sa1 + sa2;
        let total_assets_individual = client_a.total_assets();

        // ── Vault B: batch deposit ────────────────────────────────────────────
        let (env_b, client_b, _admin_b, token_b) = setup();
        let relayer = Address::generate(&env_b);
        let user_b1 = Address::generate(&env_b);
        let user_b2 = Address::generate(&env_b);

        mint(&env_b, &token_b, &user_b1, amount_a);
        mint(&env_b, &token_b, &user_b2, amount_b);

        client_b.set_relayer(&relayer, &true);

        let entries = Vec::from_array(
            &env_b,
            [
                DepositEntry { user: user_b1.clone(), amount: amount_a },
                DepositEntry { user: user_b2.clone(), amount: amount_b },
            ],
        );

        let batch_result = match client_b.try_batch_deposit(&relayer, &entries) {
            Ok(Ok(r)) => r,
            _ => return Ok(()), // if batch fails, skip (e.g. zero shares edge case)
        };

        let total_shares_batch = batch_result.total_shares_minted;
        let total_assets_batch = client_b.total_assets();

        // Both vaults start with same state, so shares must match
        prop_assert_eq!(
            total_shares_individual,
            total_shares_batch,
            "batch and individual deposits must mint equal total shares"
        );

        prop_assert!(
            (total_assets_individual - total_assets_batch).abs() <= 2,
            "total_assets must be within rounding tolerance: individual={} batch={}",
            total_assets_individual,
            total_assets_batch
        );
    }
}

// ── Property 6: withdrawal cooldown enforcement ───────────────────────────────

proptest! {
    /// A withdrawal attempted immediately after deposit must fail with
    /// WithdrawalCooldownActive when a cooldown is configured.
    #[test]
    fn prop_withdrawal_cooldown_enforced(
        deposit_amount in 1_000i128..=1_000_000i128,
        cooldown_secs in 1u64..=86_400u64,
    ) {
        use soroban_sdk::testutils::Ledger as _;
        use crate::VaultError;

        let (env, client, _admin, token) = setup();
        let user = Address::generate(&env);

        // Set a non-zero cooldown
        env.storage().instance().set(
            &crate::DataKey::WithdrawalCooldown,
            &cooldown_secs,
        );

        mint(&env, &token, &user, deposit_amount);
        let shares = match client.try_deposit(&user, &deposit_amount) {
            Ok(Ok(s)) if s > 0 => s,
            _ => return Ok(()),
        };

        // Attempt immediate withdrawal (still within cooldown window)
        let result = client.try_withdraw(&user, &shares);
        prop_assert_eq!(
            result.unwrap_err().unwrap(),
            VaultError::WithdrawalCooldownActive,
            "withdrawal within cooldown window must be rejected"
        );

        // After the cooldown expires, withdrawal must succeed
        let current_ts = env.ledger().timestamp();
        env.ledger().set_timestamp(current_ts + cooldown_secs + 1);

        let returned = client.withdraw(&user, &shares);
        prop_assert!(
            returned <= deposit_amount,
            "withdrawal after cooldown must return at most deposited amount"
        );
    }
}
