//! Vault share conversion math with deterministic rounding policy.
//!
//! See [`share_price_math`] for implementation and rounding guarantees.

pub use share_price_math::{
    assets_to_shares, shares_to_assets, try_assets_to_shares, try_shares_to_assets, MathError,
};

#[cfg(test)]
mod tests {
    use super::{
        assets_to_shares as checked_assets_to_shares,
        shares_to_assets as checked_shares_to_assets,
    };
    use share_price_math::MathError;

    fn assets_to_shares(assets: i128, total_shares: i128, total_assets: i128) -> i128 {
        checked_assets_to_shares(assets, total_shares, total_assets).unwrap()
    }

    fn shares_to_assets(shares: i128, total_shares: i128, total_assets: i128) -> i128 {
        checked_shares_to_assets(shares, total_shares, total_assets).unwrap()
    }

    #[test]
    fn test_first_deposit_one_to_one() {
        let shares = assets_to_shares(1000, 0, 0);
        assert_eq!(shares, 1000, "first deposit should get 1:1 ratio");
    }

    #[test]
    fn test_shares_to_assets_zero_supply() {
        let assets = shares_to_assets(100, 0, 1000);
        assert_eq!(assets, 0, "zero share supply should return zero assets");
    }

    #[test]
    fn test_assets_to_shares_rounds_down() {
        let shares = assets_to_shares(100, 1000, 1500);
        assert_eq!(shares, 66, "should round down to 66 shares");
    }

    #[test]
    fn test_shares_to_assets_rounds_down() {
        let assets = shares_to_assets(100, 1000, 1500);
        assert_eq!(assets, 150, "exact division should return 150");

        let assets = shares_to_assets(99, 1000, 1500);
        assert_eq!(assets, 148, "should round down to 148 assets");
    }

    #[test]
    fn test_tiny_deposit_rounds_to_zero() {
        let shares = assets_to_shares(1, 1000, 1_000_000);
        assert_eq!(shares, 0, "tiny deposit should round to zero shares");
    }

    #[test]
    fn test_tiny_withdrawal_rounds_to_zero() {
        let assets = shares_to_assets(1, 1_000_000, 1000);
        assert_eq!(assets, 0, "tiny withdrawal should round to zero assets");
    }

    #[test]
    fn test_round_trip_never_increases_value() {
        let original_assets = 300;
        let shares = assets_to_shares(original_assets, 1000, 1500);
        let recovered_assets = shares_to_assets(shares, 1000 + shares, 1500 + original_assets);

        assert!(
            recovered_assets <= original_assets,
            "round-trip should never increase value: {} > {}",
            recovered_assets,
            original_assets
        );
    }

    #[test]
    fn test_round_trip_loss_bounded() {
        let original_assets = 300;
        let shares = assets_to_shares(original_assets, 1000, 1500);
        let recovered_assets = shares_to_assets(shares, 1000 + shares, 1500 + original_assets);

        let loss = original_assets - recovered_assets;
        assert!(
            loss <= 2,
            "round-trip loss should be minimal (at most 2 units): loss = {}",
            loss
        );
    }

    #[test]
    fn test_more_assets_yields_more_shares() {
        let shares_100 = assets_to_shares(100, 1000, 1500);
        let shares_200 = assets_to_shares(200, 1000, 1500);

        assert!(
            shares_200 >= shares_100,
            "more assets should yield at least as many shares"
        );
    }

    #[test]
    fn test_more_shares_yields_more_assets() {
        let assets_100 = shares_to_assets(100, 1000, 1500);
        let assets_200 = shares_to_assets(200, 1000, 1500);

        assert!(
            assets_200 >= assets_100,
            "more shares should yield at least as many assets"
        );
    }

    #[test]
    fn test_yield_increases_share_value() {
        let assets_before = shares_to_assets(100, 1000, 1000);
        let assets_after = shares_to_assets(100, 1000, 1500);

        assert!(
            assets_after > assets_before,
            "yield should increase redemption value: {} <= {}",
            assets_after,
            assets_before
        );
    }

    #[test]
    fn test_yield_decreases_shares_per_asset() {
        let shares_before = assets_to_shares(100, 1000, 1000);
        let shares_after = assets_to_shares(100, 1000, 1500);

        assert!(
            shares_after < shares_before,
            "yield should decrease shares minted per asset: {} >= {}",
            shares_after,
            shares_before
        );
    }

    #[test]
    fn test_full_redemption_symmetry() {
        let deposit = 1000;
        let shares = assets_to_shares(deposit, 0, 0);
        assert_eq!(shares, deposit, "first deposit should be 1:1");

        let redeemed = shares_to_assets(shares, shares, deposit);
        assert_eq!(
            redeemed, deposit,
            "full redemption should return all assets"
        );
    }

    #[test]
    fn test_proportional_redemption() {
        let user_shares = 500;
        let total_shares = 1000;
        let total_assets = 2000;

        let redeemed = shares_to_assets(user_shares, total_shares, total_assets);

        assert_eq!(
            redeemed, 1000,
            "50% of shares should redeem for 50% of assets"
        );
    }

    #[test]
    fn test_single_stroop_deposit() {
        let shares = assets_to_shares(1, 1, 1);
        assert_eq!(shares, 1, "1:1 ratio should mint 1 share for 1 asset");
    }

    #[test]
    fn test_maximum_value_handling() {
        let large_value = 1_000_000_000_000i128;
        let shares = assets_to_shares(large_value, 1, 1);
        assert_eq!(shares, large_value, "large values should work correctly");
    }

    #[test]
    fn test_overflow_protection_assets_to_shares() {
        assert_eq!(
            checked_assets_to_shares(i128::MAX, i128::MAX, 1),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn test_overflow_protection_shares_to_assets() {
        assert_eq!(
            checked_shares_to_assets(i128::MAX, 1, i128::MAX),
            Err(MathError::Overflow)
        );
    }
}
