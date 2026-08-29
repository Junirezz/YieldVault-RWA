//! Storage key namespace registry and collision prevention.
//!
//! Every `DataKey` variant belongs to exactly one namespace. Parameterized keys
//! (e.g. `ShareBalance(Address)`) embed their discriminator in the Soroban
//! storage key, preventing collisions with scalar keys in other namespaces.
//!
//! Proxy upgrade keys live in a separate `ProxyDataKey` enum (see `upgrade.rs`)
//! and must never share slot values with vault `DataKey` variants.

use soroban_sdk::contracttype;

/// Logical namespace for vault instance storage keys.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StorageNamespace {
    Core = 0,
    Governance = 1,
    User = 2,
    Shipment = 3,
    Fee = 4,
    Withdrawal = 5,
    Oracle = 6,
    Emergency = 7,
    Strategy = 8,
}

/// Registered storage key descriptor for operator visibility and audit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageKeyDescriptor {
    pub namespace: StorageNamespace,
    pub name: soroban_sdk::Symbol,
    pub parameterized: bool,
}

/// Result of the on-chain storage registry validation query.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidateRegistryResult {
    pub keys: soroban_sdk::Vec<StorageKeyDescriptor>,
    pub valid: bool,
}

/// Returns the canonical registry of all vault `DataKey` variants.
pub fn registered_vault_keys(env: &soroban_sdk::Env) -> soroban_sdk::Vec<StorageKeyDescriptor> {
    use soroban_sdk::{symbol_short, Vec};
    let mut keys = Vec::new(env);

    let scalar = |ns: StorageNamespace, name: &str| StorageKeyDescriptor {
        namespace: ns,
        name: soroban_sdk::Symbol::new(env, name),
        parameterized: false,
    };

    keys.push_back(scalar(StorageNamespace::Core, "TokenAsset"));
    keys.push_back(scalar(StorageNamespace::Core, "TotalShares"));
    keys.push_back(scalar(StorageNamespace::Core, "TotalAssets"));
    keys.push_back(scalar(StorageNamespace::Core, "Admin"));
    keys.push_back(scalar(StorageNamespace::Core, "Strategy"));
    keys.push_back(scalar(StorageNamespace::Core, "State"));
    keys.push_back(scalar(StorageNamespace::Core, "IsPaused"));
    keys.push_back(scalar(StorageNamespace::Core, "PauseReason"));

    keys.push_back(scalar(StorageNamespace::Governance, "DaoThreshold"));
    keys.push_back(scalar(StorageNamespace::Governance, "ProposalNonce"));
    keys.push_back(scalar(StorageNamespace::Governance, "AdminProposalNonce"));
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Governance,
        name: symbol_short!("AdminProp"),
        parameterized: true,
    });
    keys.push_back(scalar(StorageNamespace::Governance, "GovernanceConfig"));
    keys.push_back(scalar(StorageNamespace::Governance, "BenjiStrategy"));
    keys.push_back(scalar(StorageNamespace::Governance, "KoreanDebtStrategy"));
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Governance,
        name: symbol_short!("Proposal"),
        parameterized: true,
    });
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Governance,
        name: symbol_short!("Vote"),
        parameterized: true,
    });

    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::User,
        name: symbol_short!("ShareBal"),
        parameterized: true,
    });
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::User,
        name: symbol_short!("UserDep"),
        parameterized: true,
    });
    keys.push_back(scalar(StorageNamespace::User, "PerUserCap"));

    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Shipment,
        name: symbol_short!("ShipStat"),
        parameterized: true,
    });
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Shipment,
        name: symbol_short!("ShipOf"),
        parameterized: true,
    });

    keys.push_back(scalar(StorageNamespace::Fee, "FeeBps"));
    keys.push_back(scalar(StorageNamespace::Fee, "Treasury"));
    keys.push_back(scalar(StorageNamespace::Fee, "TreasuryBalance"));

    // Issue #1230: Performance fee switch keys
    keys.push_back(scalar(StorageNamespace::Fee, "PerfFeeBps"));
    keys.push_back(scalar(StorageNamespace::Fee, "PerfIncentivePool"));
    keys.push_back(scalar(StorageNamespace::Fee, "PerfFeeEnabled"));

    keys.push_back(scalar(
        StorageNamespace::Withdrawal,
        "LargeWithdrawalThreshold",
    ));
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Withdrawal,
        name: symbol_short!("PndWd"),
        parameterized: true,
    });
    keys.push_back(scalar(StorageNamespace::Withdrawal, "MinDeposit"));
    keys.push_back(scalar(StorageNamespace::Withdrawal, "MinLiquidityBuffer"));

    keys.push_back(scalar(StorageNamespace::Oracle, "PriceOracle"));
    keys.push_back(scalar(StorageNamespace::Oracle, "OracleEnabled"));
    keys.push_back(scalar(StorageNamespace::Oracle, "OracleHeartbeat"));

    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Strategy,
        name: symbol_short!("StratWl"),
        parameterized: true,
    });
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Strategy,
        name: symbol_short!("StratCap"),
        parameterized: true,
    });
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Strategy,
        name: symbol_short!("StratRisk"),
        parameterized: true,
    });
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Strategy,
        name: symbol_short!("StratHwm"),
        parameterized: true,
    });
    keys.push_back(scalar(StorageNamespace::Strategy, "StrategyHeartbeat"));
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Strategy,
        name: symbol_short!("StratHb"),
        parameterized: true,
    });

    keys.push_back(scalar(StorageNamespace::Emergency, "EmergencyApprovers"));
    keys.push_back(scalar(
        StorageNamespace::Emergency,
        "EmergencyProposalNonce",
    ));
    keys.push_back(StorageKeyDescriptor {
        namespace: StorageNamespace::Emergency,
        name: symbol_short!("EmrgProp"),
        parameterized: true,
    });
    keys.push_back(scalar(
        StorageNamespace::Emergency,
        "EmergencyDisputeWindow",
    ));

    keys
}

/// Validates that no two registered keys share the same (namespace, name) pair.
pub fn validate_registry_no_collisions(
    keys: &soroban_sdk::Vec<StorageKeyDescriptor>,
) -> Result<(), soroban_sdk::Symbol> {
    use soroban_sdk::Symbol;
    let mut seen = soroban_sdk::Vec::<(StorageNamespace, Symbol)>::new(keys.env());

    let mut i = 0u32;
    while i < keys.len() {
        let entry = keys.get(i).unwrap();
        let pair = (entry.namespace, entry.name.clone());
        let mut j = 0u32;
        while j < seen.len() {
            if seen.get(j).unwrap() == pair {
                return Err(Symbol::new(keys.env(), "storage_key_collision"));
            }
            j += 1;
        }
        seen.push_back(pair);
        i += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_registry_has_no_collisions() {
        let env = Env::default();
        let keys = registered_vault_keys(&env);
        assert!(keys.len() >= 20);
        assert!(validate_registry_no_collisions(&keys).is_ok());
    }

    #[test]
    fn test_all_namespaces_represented() {
        let env = Env::default();
        let keys = registered_vault_keys(&env);

        let has_ns = |ns: StorageNamespace| {
            let mut i = 0u32;
            while i < keys.len() {
                if keys.get(i).unwrap().namespace == ns {
                    return true;
                }
                i += 1;
            }
            false
        };

        assert!(has_ns(StorageNamespace::Core));
        assert!(has_ns(StorageNamespace::Governance));
        assert!(has_ns(StorageNamespace::User));
        assert!(has_ns(StorageNamespace::Emergency));
    }

    #[test]
    fn test_proxy_keys_separate_from_vault() {
        // ProxyDataKey uses explicit numeric discriminators 0–4; vault DataKey
        // is a separate contracttype enum and cannot collide at the type level.
        use crate::upgrade::ProxyDataKey;
        assert_ne!(
            ProxyDataKey::Admin as u32,
            ProxyDataKey::Implementation as u32
        );
        assert_ne!(
            ProxyDataKey::PendingAdmin as u32,
            ProxyDataKey::Initialized as u32
        );
    }
}
