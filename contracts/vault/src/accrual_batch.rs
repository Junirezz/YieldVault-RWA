//! Batched yield accrual (#1735).
//!
//! `accrue_yield` normally applies every accrual to vault state and the
//! treasury immediately. With batching enabled, small accruals are summed into
//! a single [`PendingAccrual`] slot instead, and committed to vault state and
//! the treasury in one step once either threshold is reached:
//!
//! * `min_flush_amount`: the pending net yield has reached this amount, or
//! * `max_age_secs`: the oldest pending accrual is at least this old
//!   (`0` disables the time trigger).
//!
//! Tokens always move at accrual time; only the *bookkeeping* is deferred.
//! Any read or write of vault state first folds the pending amount in, so no
//! yield is ever invisible to share-price calculations.
//!
//! Batching is disabled by default (`min_flush_amount == 0`), which keeps the
//! original apply-immediately behaviour.
//!
//! Keys are standalone symbols because `DataKey` is at Soroban's 50-variant
//! limit for `#[contracttype]` enums.

use soroban_sdk::{contracttype, symbol_short, Env, Symbol};

const PENDING_KEY: Symbol = symbol_short!("PENDACC");
const CONFIG_KEY: Symbol = symbol_short!("ACCCFG");

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AccrualBatchConfig {
    /// Flush once pending net yield reaches this amount. `0` disables batching.
    pub min_flush_amount: i128,
    /// Flush once the oldest pending accrual is this many seconds old. `0` = no time trigger.
    pub max_age_secs: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PendingAccrual {
    /// Yield (after protocol fee) not yet folded into `VaultState.total_assets`.
    pub net_yield: i128,
    /// Protocol fee not yet credited to the treasury.
    pub fee: i128,
    /// Ledger timestamp of the first accrual in this batch.
    pub since: u64,
}

impl AccrualBatchConfig {
    pub fn is_enabled(&self) -> bool {
        self.min_flush_amount > 0
    }
}

pub fn read_config(env: &Env) -> AccrualBatchConfig {
    env.storage()
        .instance()
        .get(&CONFIG_KEY)
        .unwrap_or(AccrualBatchConfig {
            min_flush_amount: 0,
            max_age_secs: 0,
        })
}

pub fn write_config(env: &Env, cfg: &AccrualBatchConfig) {
    env.storage().instance().set(&CONFIG_KEY, cfg);
}

pub fn read_pending(env: &Env) -> Option<PendingAccrual> {
    env.storage().instance().get(&PENDING_KEY)
}

pub fn write_pending(env: &Env, pending: &PendingAccrual) {
    env.storage().instance().set(&PENDING_KEY, pending);
}

pub fn clear_pending(env: &Env) {
    env.storage().instance().remove(&PENDING_KEY);
}

/// Adds one accrual to the pending batch. `None` on arithmetic overflow.
pub fn add_to_pending(
    existing: Option<PendingAccrual>,
    net_yield: i128,
    fee: i128,
    now: u64,
) -> Option<PendingAccrual> {
    match existing {
        Some(p) => Some(PendingAccrual {
            net_yield: p.net_yield.checked_add(net_yield)?,
            fee: p.fee.checked_add(fee)?,
            since: p.since,
        }),
        None => Some(PendingAccrual {
            net_yield,
            fee,
            since: now,
        }),
    }
}

/// True when the batch must be committed.
pub fn should_flush(cfg: &AccrualBatchConfig, pending: &PendingAccrual, now: u64) -> bool {
    pending.net_yield >= cfg.min_flush_amount
        || (cfg.max_age_secs > 0 && now.saturating_sub(pending.since) >= cfg.max_age_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CFG: AccrualBatchConfig = AccrualBatchConfig {
        min_flush_amount: 100,
        max_age_secs: 60,
    };

    #[test]
    fn add_starts_and_accumulates_batch() {
        let p = add_to_pending(None, 10, 1, 500).unwrap();
        assert_eq!((p.net_yield, p.fee, p.since), (10, 1, 500));
        let p = add_to_pending(Some(p), 5, 2, 900).unwrap();
        assert_eq!((p.net_yield, p.fee, p.since), (15, 3, 500));
    }

    #[test]
    fn add_detects_overflow() {
        let p = add_to_pending(None, i128::MAX, 0, 0).unwrap();
        assert!(add_to_pending(Some(p), 1, 0, 0).is_none());
    }

    #[test]
    fn flush_on_amount_threshold() {
        let p = PendingAccrual { net_yield: 99, fee: 0, since: 0 };
        assert!(!should_flush(&CFG, &p, 10));
        let p = PendingAccrual { net_yield: 100, fee: 0, since: 0 };
        assert!(should_flush(&CFG, &p, 10));
    }

    #[test]
    fn flush_on_age_threshold() {
        let p = PendingAccrual { net_yield: 1, fee: 0, since: 100 };
        assert!(!should_flush(&CFG, &p, 159));
        assert!(should_flush(&CFG, &p, 160));
    }

    #[test]
    fn age_trigger_disabled_when_zero() {
        let cfg = AccrualBatchConfig { min_flush_amount: 100, max_age_secs: 0 };
        let p = PendingAccrual { net_yield: 1, fee: 0, since: 0 };
        assert!(!should_flush(&cfg, &p, u64::MAX));
    }
}
