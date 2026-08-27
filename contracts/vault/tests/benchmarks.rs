//! Nightly contract benchmarks for core vault operations (Issue #1235).
//!
//! Measures Soroban host CPU and memory for deposit, withdraw, invest, and
//! strategy switch across two strategy instances. Run with:
//!
//! ```bash
//! cargo test -p vault --test benchmarks -- --nocapture
//! ```
//!
//! Lines prefixed with `BENCH` are parsed by `contracts/vault/scripts/benchmark.sh`.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};
use vault::benji_strategy::{BenjiStrategy, BenjiStrategyClient};
use vault::{YieldVault, YieldVaultClient};

fn create_token<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &addr)
}

fn print_bench(op: &str, strategy: &str, cpu: u64, mem: u64) {
    std::println!("BENCH op={op} strategy={strategy} cpu={cpu} mem={mem}");
}

fn snapshot(env: &Env) -> (u64, u64) {
    let budget = env.cost_estimate().budget();
    (budget.cpu_instruction_cost(), budget.memory_bytes_cost())
}

#[test]
fn bench_core_vault_operations() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_sa = token::StellarAssetClient::new(&env, &usdc.address);
    let benji_a = create_token(&env, &token_admin);
    let benji_b = create_token(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    let strategy_a_id = env.register(BenjiStrategy, ());
    let strategy_a = BenjiStrategyClient::new(&env, &strategy_a_id);
    strategy_a.initialize(&vault_id, &usdc.address, &benji_a.address);
    vault.whitelist_strategy(&strategy_a_id, &true);

    let strategy_b_id = env.register(BenjiStrategy, ());
    let strategy_b = BenjiStrategyClient::new(&env, &strategy_b_id);
    strategy_b.initialize(&vault_id, &usdc.address, &benji_b.address);
    vault.whitelist_strategy(&strategy_b_id, &true);

    vault.set_strategy_heartbeat(&0);
    vault.set_strategy(&strategy_a_id);

    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_000_000);

    vault.deposit(&user, &10_000);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.deposit(&user, &1_000);
    let (cpu, mem) = snapshot(&env);
    print_bench("deposit", "benji_v1", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.invest(&2_000);
    let (cpu, mem) = snapshot(&env);
    print_bench("invest", "benji_v1", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.set_strategy(&strategy_b_id);
    let (cpu, mem) = snapshot(&env);
    print_bench("switch_strategy", "benji_v1_to_v2", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.withdraw(&user, &500);
    let (cpu, mem) = snapshot(&env);
    print_bench("withdraw", "benji_v2", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.deposit(&user, &1_000);
    let (cpu, mem) = snapshot(&env);
    print_bench("deposit", "benji_v2", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.invest(&1_000);
    let (cpu, mem) = snapshot(&env);
    print_bench("invest", "benji_v2", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.set_strategy(&strategy_a_id);
    let (cpu, mem) = snapshot(&env);
    print_bench("switch_strategy", "benji_v2_to_v1", cpu, mem);

    {
        let mut budget = env.cost_estimate().budget();
        budget.reset_unlimited();
    }
    vault.withdraw(&user, &500);
    let (cpu, mem) = snapshot(&env);
    print_bench("withdraw", "benji_v1", cpu, mem);
}
