use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleFailureMode {
    None = 0,
    StaleHeartbeat = 1,
    ZeroPrice = 2,
    NegativePrice = 3,
    InvalidDecimals = 4,
    DeviationSpike = 5,
    FutureTimestamp = 6,
    NetworkPartition = 7,
    Timeout = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    PriceData,
    StaleData,
    ZeroPrice,
    NegativePrice,
    InvalidDecimals,
    FailureMode,
}

pub type PriceData = (i128, u64, u32);

pub fn price_data_new(price: i128, timestamp: u64, decimals: u32) -> PriceData {
    (price, timestamp, decimals)
}

#[contract]
pub struct MockPriceOracle;

#[contractimpl]
impl MockPriceOracle {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StaleData, &false);
        env.storage().instance().set(&DataKey::ZeroPrice, &false);
        env.storage()
            .instance()
            .set(&DataKey::NegativePrice, &false);
        env.storage()
            .instance()
            .set(&DataKey::InvalidDecimals, &false);
        env.storage()
            .instance()
            .set(&DataKey::FailureMode, &OracleFailureMode::None);
    }

    pub fn set_price(env: Env, price: i128, timestamp: u64, decimals: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let price_data = price_data_new(price, timestamp, decimals);
        env.storage()
            .instance()
            .set(&DataKey::PriceData, &price_data);
    }

    pub fn set_stale_data_mode(env: Env, stale: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::StaleData, &stale);
    }

    pub fn set_zero_price_mode(env: Env, zero: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::ZeroPrice, &zero);
    }

    pub fn set_negative_price_mode(env: Env, negative: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::NegativePrice, &negative);
    }

    pub fn set_invalid_decimals_mode(env: Env, invalid: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::InvalidDecimals, &invalid);
    }

    /// Configure a single failure mode, clearing the others.
    pub fn set_failure_mode(env: Env, mode: OracleFailureMode) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::FailureMode, &mode);
        env.storage().instance().set(
            &DataKey::StaleData,
            &(mode == OracleFailureMode::StaleHeartbeat),
        );
        env.storage()
            .instance()
            .set(&DataKey::ZeroPrice, &(mode == OracleFailureMode::ZeroPrice));
        env.storage().instance().set(
            &DataKey::NegativePrice,
            &(mode == OracleFailureMode::NegativePrice),
        );
        env.storage().instance().set(
            &DataKey::InvalidDecimals,
            &(mode == OracleFailureMode::InvalidDecimals),
        );
    }

    pub fn failure_mode(env: Env) -> OracleFailureMode {
        env.storage()
            .instance()
            .get(&DataKey::FailureMode)
            .unwrap_or(OracleFailureMode::None)
    }

    pub fn get_price(env: Env, _base: Address, _quote: Address) -> PriceData {
        let mode: OracleFailureMode = env
            .storage()
            .instance()
            .get(&DataKey::FailureMode)
            .unwrap_or(OracleFailureMode::None);

        match mode {
            OracleFailureMode::NetworkPartition => {
                panic!("oracle network partition");
            }
            OracleFailureMode::Timeout => {
                panic!("oracle timeout");
            }
            _ => {}
        }

        let is_stale = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::StaleData)
            .unwrap_or(false)
            || mode == OracleFailureMode::StaleHeartbeat;
        let is_zero = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::ZeroPrice)
            .unwrap_or(false)
            || mode == OracleFailureMode::ZeroPrice;
        let is_negative = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::NegativePrice)
            .unwrap_or(false)
            || mode == OracleFailureMode::NegativePrice;
        let has_invalid_decimals = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::InvalidDecimals)
            .unwrap_or(false)
            || mode == OracleFailureMode::InvalidDecimals;
        let is_spike = mode == OracleFailureMode::DeviationSpike;
        let is_future = mode == OracleFailureMode::FutureTimestamp;

        let price_data: Option<PriceData> = env.storage().instance().get(&DataKey::PriceData);

        if let Some(mut data) = price_data {
            if is_stale {
                data.1 = env.ledger().timestamp().saturating_sub(7200);
            }
            if is_future {
                data.1 = env.ledger().timestamp().saturating_add(3600);
            }
            if is_zero {
                data.0 = 0;
            }
            if is_negative {
                data.0 = -1000000000i128;
            }
            if has_invalid_decimals {
                data.2 = 35;
            }
            if is_spike {
                data.0 = data.0.saturating_mul(3);
            }
            data
        } else {
            let mut data = price_data_new(1_000_000_000i128, env.ledger().timestamp(), 18);
            if is_stale {
                data.1 = env.ledger().timestamp().saturating_sub(7200);
            }
            if is_future {
                data.1 = env.ledger().timestamp().saturating_add(3600);
            }
            if is_zero {
                data.0 = 0;
            }
            if is_negative {
                data.0 = -1000000000i128;
            }
            if has_invalid_decimals {
                data.2 = 35;
            }
            if is_spike {
                data.0 = data.0.saturating_mul(3);
            }
            data
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    fn setup(env: &Env) -> (MockPriceOracleClient<'_>, Address) {
        let admin = Address::generate(env);
        let id = env.register(MockPriceOracle, ());
        let oracle = MockPriceOracleClient::new(env, &id);
        oracle.initialize(&admin);
        (oracle, admin)
    }

    #[test]
    fn default_price_is_fresh_and_positive() {
        let env = Env::default();
        env.mock_all_auths();
        let (oracle, _) = setup(&env);
        let quote = Address::generate(&env);
        let data = oracle.get_price(&quote, &quote);
        assert_eq!(data.0, 1_000_000_000i128);
        assert_eq!(data.2, 18);
        assert_eq!(data.1, env.ledger().timestamp());
    }

    #[test]
    fn stale_heartbeat_mode_ages_the_timestamp() {
        let env = Env::default();
        env.mock_all_auths();
        let (oracle, _) = setup(&env);
        env.ledger().with_mut(|li| li.timestamp = 10_000);
        oracle.set_failure_mode(&OracleFailureMode::StaleHeartbeat);
        let quote = Address::generate(&env);
        let data = oracle.get_price(&quote, &quote);
        assert_eq!(data.1, 10_000u64.saturating_sub(7200));
    }

    #[test]
    fn deviation_spike_triples_the_price() {
        let env = Env::default();
        env.mock_all_auths();
        let (oracle, _) = setup(&env);
        oracle.set_price(&1_000_000_000, &env.ledger().timestamp(), &18);
        oracle.set_failure_mode(&OracleFailureMode::DeviationSpike);
        let quote = Address::generate(&env);
        let data = oracle.get_price(&quote, &quote);
        assert_eq!(data.0, 3_000_000_000i128);
    }

    #[test]
    fn zero_and_negative_and_invalid_decimal_modes() {
        let env = Env::default();
        env.mock_all_auths();
        let (oracle, _) = setup(&env);
        let quote = Address::generate(&env);

        oracle.set_failure_mode(&OracleFailureMode::ZeroPrice);
        assert_eq!(oracle.get_price(&quote, &quote).0, 0);

        oracle.set_failure_mode(&OracleFailureMode::NegativePrice);
        assert!(oracle.get_price(&quote, &quote).0 < 0);

        oracle.set_failure_mode(&OracleFailureMode::InvalidDecimals);
        assert_eq!(oracle.get_price(&quote, &quote).2, 35);

        oracle.set_failure_mode(&OracleFailureMode::FutureTimestamp);
        let ts = oracle.get_price(&quote, &quote).1;
        assert!(ts > env.ledger().timestamp());
    }

    #[test]
    #[should_panic(expected = "oracle network partition")]
    fn network_partition_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (oracle, _) = setup(&env);
        oracle.set_failure_mode(&OracleFailureMode::NetworkPartition);
        let quote = Address::generate(&env);
        let _ = oracle.get_price(&quote, &quote);
    }

    #[test]
    #[should_panic(expected = "oracle timeout")]
    fn timeout_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (oracle, _) = setup(&env);
        oracle.set_failure_mode(&OracleFailureMode::Timeout);
        let quote = Address::generate(&env);
        let _ = oracle.get_price(&quote, &quote);
    }
}
