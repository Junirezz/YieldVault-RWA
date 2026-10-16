//! Deterministic rounding policy for vault share conversions.
//!
//! The vault must never round in the user's favour: rounding always leaves the
//! residual dust with the vault, so `deposit -> withdraw` round trips can never
//! mint value out of nothing.

use crate::MathError;
//!
//! | Operation  | Direction | Rounding |
//! |------------|-----------|----------|
//! | `deposit`  | assets to shares | [`Rounding::Down`] |
//! | `mint`     | shares to assets | [`Rounding::Up`]   |
//! | `withdraw` | assets to shares | [`Rounding::Up`]   |
//! | `redeem`   | shares to assets | [`Rounding::Down`] |
//!
//! [`FIXTURES`] is the canonical cross-language conformance table. The same
//! vectors are published as `fixtures/rounding_fixtures.json` so that the
//! TypeScript SDK and the backend quote service can assert byte-identical
//! results against this implementation.

/// Rounding direction applied to the residual of an integer division.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Rounding {
    /// Truncate the remainder (floor for non-negative operands).
    Down,
    /// Push the result away from zero whenever a remainder exists.
    Up,
}

impl Rounding {
    /// Stable string tag used in the JSON fixture file.
    pub fn as_str(&self) -> &'static str {
        match self {
            Rounding::Down => "down",
            Rounding::Up => "up",
        }
    }
}

/// Vault operation covered by the rounding policy.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Op {
    Deposit,
    Mint,
    Withdraw,
    Redeem,
}

impl Op {
    /// Rounding direction mandated by the policy for this operation.
    pub fn rounding(&self) -> Rounding {
        match self {
            Op::Deposit | Op::Redeem => Rounding::Down,
            Op::Mint | Op::Withdraw => Rounding::Up,
        }
    }

    /// Stable string tag used in the JSON fixture file.
    pub fn as_str(&self) -> &'static str {
        match self {
            Op::Deposit => "deposit",
            Op::Mint => "mint",
            Op::Withdraw => "withdraw",
            Op::Redeem => "redeem",
        }
    }
}

/// `a * b / denom` with an explicit rounding direction.
///
/// Returns an error on i128 overflow or a zero denominator.
pub fn mul_div(a: i128, b: i128, denom: i128, rounding: Rounding) -> Result<i128, MathError> {
    if denom == 0 {
        return Err(MathError::DivisionByZero);
    }

    let product = a.checked_mul(b).ok_or(MathError::Overflow)?;
    let quotient = product.checked_div(denom).ok_or(MathError::Overflow)?;

    match rounding {
        Rounding::Down => Ok(quotient),
        Rounding::Up => {
            let remainder = product.checked_rem(denom).ok_or(MathError::Overflow)?;
            if remainder == 0 {
                Ok(quotient)
            } else {
                quotient.checked_add(1).ok_or(MathError::Overflow)
            }
        }
    }
}

/// Converts assets to shares under the policy rounding for `op`.
///
/// An empty vault (no shares or no assets) mints 1:1.
pub fn assets_to_shares_rounded(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
    op: Op,
) -> Result<i128, MathError> {
    if total_assets == 0 || total_shares == 0 {
        return Ok(assets);
    }
    mul_div(assets, total_shares, total_assets, op.rounding())
}

/// Converts shares to assets under the policy rounding for `op`.
///
/// A vault with no outstanding shares redeems to zero.
pub fn shares_to_assets_rounded(
    shares: i128,
    total_shares: i128,
    total_assets: i128,
    op: Op,
) -> Result<i128, MathError> {
    if total_shares == 0 {
        return Ok(0);
    }
    mul_div(shares, total_assets, total_shares, op.rounding())
}

/// One conformance vector. `amount` is assets for deposit/withdraw and shares
/// for mint/redeem; `expected` is the converted amount in the opposite unit.
#[derive(Copy, Clone, Debug)]
pub struct RoundingFixture {
    pub id: &'static str,
    pub op: Op,
    pub amount: i128,
    pub total_shares: i128,
    pub total_assets: i128,
    pub expected: i128,
}

/// Canonical cross-language rounding vectors.
///
/// Mirrored verbatim by `fixtures/rounding_fixtures.json`.
pub const FIXTURES: &[RoundingFixture] = &[
    RoundingFixture {
        id: "empty-vault-first-deposit",
        op: Op::Deposit,
        amount: 1_000,
        total_shares: 0,
        total_assets: 0,
        expected: 1_000,
    },
    RoundingFixture {
        id: "deposit-exact-division",
        op: Op::Deposit,
        amount: 300,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 200,
    },
    RoundingFixture {
        id: "deposit-truncates-residual",
        op: Op::Deposit,
        amount: 100,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 66,
    },
    RoundingFixture {
        id: "deposit-dust-rounds-to-zero",
        op: Op::Deposit,
        amount: 1,
        total_shares: 1_000,
        total_assets: 1_000_000,
        expected: 0,
    },
    RoundingFixture {
        id: "withdraw-charges-extra-share",
        op: Op::Withdraw,
        amount: 100,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 67,
    },
    RoundingFixture {
        id: "withdraw-exact-division-no-bump",
        op: Op::Withdraw,
        amount: 300,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 200,
    },
    RoundingFixture {
        id: "redeem-truncates-residual",
        op: Op::Redeem,
        amount: 99,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 148,
    },
    RoundingFixture {
        id: "redeem-dust-rounds-to-zero",
        op: Op::Redeem,
        amount: 1,
        total_shares: 1_000_000,
        total_assets: 1_000,
        expected: 0,
    },
    RoundingFixture {
        id: "mint-charges-extra-asset",
        op: Op::Mint,
        amount: 99,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 149,
    },
    RoundingFixture {
        id: "mint-empty-vault-is-zero",
        op: Op::Mint,
        amount: 500,
        total_shares: 0,
        total_assets: 0,
        expected: 0,
    },
];

/// Evaluates a fixture with the production conversion helpers.
pub fn evaluate(fixture: &RoundingFixture) -> Result<i128, MathError> {
    match fixture.op {
        Op::Deposit | Op::Withdraw => assets_to_shares_rounded(
            fixture.amount,
            fixture.total_shares,
            fixture.total_assets,
            fixture.op,
        ),
        Op::Mint | Op::Redeem => shares_to_assets_rounded(
            fixture.amount,
            fixture.total_shares,
            fixture.total_assets,
            fixture.op,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_fixtures_match() {
        for fixture in FIXTURES {
            assert_eq!(
                evaluate(fixture),
                Ok(fixture.expected),
                "fixture `{}` diverged from the rounding policy",
                fixture.id
            );
        }
    }

    #[test]
    fn mul_div_rejects_zero_denominator() {
        assert_eq!(
            mul_div(10, 10, 0, Rounding::Down),
            Err(MathError::DivisionByZero)
        );
        assert_eq!(
            mul_div(10, 10, 0, Rounding::Up),
            Err(MathError::DivisionByZero)
        );
    }

    #[test]
    fn mul_div_rejects_overflow() {
        assert_eq!(
            mul_div(i128::MAX, 2, 3, Rounding::Down),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn rounding_up_only_bumps_on_remainder() {
        assert_eq!(mul_div(10, 3, 5, Rounding::Up), Ok(6));
        assert_eq!(mul_div(10, 3, 4, Rounding::Up), Ok(8));
    }

    #[test]
    fn withdraw_never_cheaper_than_deposit() {
        // The policy must never let a round trip mint value: the shares burned
        // on withdraw are always >= the shares minted for the same assets.
        let (total_shares, total_assets) = (1_000, 1_500);
        for assets in 1..500i128 {
            let minted =
                assets_to_shares_rounded(assets, total_shares, total_assets, Op::Deposit).unwrap();
            let burned =
                assets_to_shares_rounded(assets, total_shares, total_assets, Op::Withdraw).unwrap();
            assert!(
                burned >= minted,
                "round trip leaked value at {assets} assets"
            );
        }
    }

    #[test]
    fn policy_directions_are_stable() {
        assert_eq!(Op::Deposit.rounding(), Rounding::Down);
        assert_eq!(Op::Redeem.rounding(), Rounding::Down);
        assert_eq!(Op::Mint.rounding(), Rounding::Up);
        assert_eq!(Op::Withdraw.rounding(), Rounding::Up);
    }
}
