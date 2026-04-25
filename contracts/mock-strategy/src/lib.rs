#![no_std]

#[cfg(not(target_arch = "wasm32"))]
pub mod mock_oracle;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    Vault,
    BaseYield,
    StepYield,
    Epoch,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MockStrategyError {
    AlreadyInitialized = 1,
}

#[contract]
pub struct MockKoreanSovereignStrategy;

#[contractimpl]
impl MockKoreanSovereignStrategy {
    pub fn initialize(
        env: Env,
        admin: Address,
        vault: Address,
        base_yield: i128,
        step_yield: i128,
    ) -> Result<(), MockStrategyError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(MockStrategyError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Vault, &vault);
        env.storage()
            .instance()
            .set(&DataKey::BaseYield, &base_yield);
        env.storage()
            .instance()
            .set(&DataKey::StepYield, &step_yield);
        env.storage().instance().set(&DataKey::Epoch, &0u32);

        Ok(())
    }

    pub fn set_yield_curve(env: Env, base_yield: i128, step_yield: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::BaseYield, &base_yield);
        env.storage()
            .instance()
            .set(&DataKey::StepYield, &step_yield);
    }

    pub fn preview_next_yield(env: Env) -> i128 {
        let base: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BaseYield)
            .unwrap_or(0);
        let step: i128 = env
            .storage()
            .instance()
            .get(&DataKey::StepYield)
            .unwrap_or(0);
        let epoch: u32 = env.storage().instance().get(&DataKey::Epoch).unwrap_or(0);

        base + step * (epoch as i128)
    }

    pub fn harvest_yield(env: Env) -> i128 {
        let amount = Self::preview_next_yield(env.clone());
        let epoch: u32 = env.storage().instance().get(&DataKey::Epoch).unwrap_or(0);
        env.storage().instance().set(&DataKey::Epoch, &(epoch + 1));

        amount
    }
}
