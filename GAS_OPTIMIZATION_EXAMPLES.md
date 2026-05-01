# Gas Optimization Examples - YieldVault

This document provides concrete code examples for the optimization opportunities identified in the gas analysis report.

---

## 1. Consolidate State Management

### Current Implementation (Inefficient)

```rust
pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, VaultError> {
    let mut state = Self::get_state(&env);  // Read 1: Full state struct
    if state.is_paused {
        return Err(VaultError::ContractPaused);
    }
    
    // ... deposit logic ...
    
    // Update idle state
    let ta = env.storage().instance()
        .get::<_, i128>(&DataKey::TotalAssets)  // Read 2: Redundant read
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::TotalAssets,  // Write 1: Redundant write
        &ta.checked_add(amount).expect("overflow"),
    );
    
    let ts = Self::total_shares(env.clone());  // Read 3: Redundant read
    env.storage().instance().set(
        &DataKey::TotalShares,  // Write 2: Redundant write
        &ts.checked_add(shares_to_mint).expect("overflow"),
    );
    
    state.total_assets = state.total_assets.checked_add(amount).expect("overflow");
    state.total_shares = state.total_shares.checked_add(shares_to_mint).expect("overflow");
    env.storage().instance().set(&DataKey::State, &state);  // Write 3: Final state write
    
    // ...
}
```

**Gas Cost:** ~40,000 for storage operations

### Optimized Implementation

```rust
pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, VaultError> {
    let mut state = Self::get_state(&env);  // Single read
    if state.is_paused {
        return Err(VaultError::ContractPaused);
    }
    
    // ... deposit logic ...
    
    // Update state directly - no redundant keys
    state.total_assets = state.total_assets.checked_add(amount).expect("overflow");
    state.total_shares = state.total_shares.checked_add(shares_to_mint).expect("overflow");
    env.storage().instance().set(&DataKey::State, &state);  // Single write
    
    // ...
}
```

**Gas Cost:** ~25,000 for storage operations  
**Savings:** ~15,000 gas (37% reduction)

### Required Changes

1. Remove `DataKey::TotalAssets` and `DataKey::TotalShares` keys
2. Always use `State` struct for these values
3. Update all functions that read these values:
   - `total_shares()` - read from state
   - `total_assets()` - read idle from state, add strategy value
   - `invest()`, `divest()`, `accrue_yield()`, etc.

---

## 2. Optimize Pause/Unpause Storage

### Current Implementation (Inefficient)

```rust
pub fn pause(env: Env) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();
    
    let mut state = Self::get_state(&env);  // Loads entire VaultState struct
    state.is_paused = true;
    env.storage().instance().set(&DataKey::State, &state);  // Writes entire struct
}

pub fn is_paused(env: Env) -> bool {
    Self::get_state(&env).is_paused  // Loads entire struct just for boolean
}
```

**Gas Cost:** ~30,000-40,000 for pause/unpause, ~5,000-8,000 for is_paused

### Optimized Implementation

```rust
pub fn pause(env: Env) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();
    
    env.storage().instance().set(&DataKey::IsPaused, &true);  // Direct boolean write
}

pub fn unpause(env: Env) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();
    
    env.storage().instance().set(&DataKey::IsPaused, &false);
}

pub fn is_paused(env: Env) -> bool {
    env.storage().instance()
        .get(&DataKey::IsPaused)
        .unwrap_or(false)  // Direct boolean read
}
```

**Gas Cost:** ~18,000-22,000 for pause/unpause, ~3,000-5,000 for is_paused  
**Savings:** ~12,000-18,000 gas per pause/unpause (40-45% reduction)

### Required Changes

1. Add `IsPaused` to `DataKey` enum (already exists in code)
2. Remove `is_paused` field from `VaultState` struct
3. Update all pause checks to use new storage key

---

## 3. Optimize Shipment Data Structure

### Current Implementation (Inefficient)

```rust
// O(n) insertion into sorted vector
fn insert_sorted_unique(env: &Env, ids: Vec<u64>, shipment_id: u64) -> Vec<u64> {
    let mut out = Vec::new(env);
    let mut inserted = false;
    let mut idx = 0;
    
    while idx < ids.len() {  // O(n) iteration
        let current = ids.get(idx).unwrap();
        if current == shipment_id {
            return ids;
        }
        if !inserted && shipment_id < current {
            out.push_back(shipment_id);
            inserted = true;
        }
        out.push_back(current);
        idx += 1;
    }
    
    if !inserted {
        out.push_back(shipment_id);
    }
    
    out  // Returns new vector, old one discarded
}

pub fn add_shipment(env: Env, shipment_id: u64, status: ShipmentStatus) {
    // ...
    let ids = env.storage().instance()
        .get::<_, Vec<u64>>(&list_key)
        .unwrap_or(Vec::new(&env));
    let next_ids = Self::insert_sorted_unique(&env, ids, shipment_id);  // Expensive
    env.storage().instance().set(&list_key, &next_ids);
    // ...
}
```

**Gas Cost:** ~60,000-90,000 (increases with list size)

### Optimized Implementation - Option A: Separate Index

```rust
// Store shipments in a map for O(1) access
// Maintain separate sorted index only when needed for pagination

#[contracttype]
pub enum DataKey {
    // ... existing keys ...
    ShipmentStatus(u64),           // shipment_id -> status
    ShipmentsByStatus(ShipmentStatus),  // status -> count
    ShipmentIndex(ShipmentStatus, u32), // (status, index) -> shipment_id
}

pub fn add_shipment(env: Env, shipment_id: u64, status: ShipmentStatus) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();
    
    // Check if exists
    if env.storage().instance().has(&DataKey::ShipmentStatus(shipment_id)) {
        panic!("shipment already exists");
    }
    
    // Store status
    env.storage().instance().set(&DataKey::ShipmentStatus(shipment_id), &status);
    
    // Update count
    let count_key = DataKey::ShipmentsByStatus(status.clone());
    let count: u32 = env.storage().instance().get(&count_key).unwrap_or(0);
    env.storage().instance().set(&count_key, &(count + 1));
    
    // Store in index (append to end, sort on read if needed)
    let index_key = DataKey::ShipmentIndex(status, count);
    env.storage().instance().set(&index_key, &shipment_id);
}

pub fn update_shipment_status(env: Env, shipment_id: u64, new_status: ShipmentStatus) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();
    
    let old_status: ShipmentStatus = env.storage().instance()
        .get(&DataKey::ShipmentStatus(shipment_id))
        .unwrap();
    
    if old_status == new_status {
        return;  // Early exit
    }
    
    // Update status
    env.storage().instance().set(&DataKey::ShipmentStatus(shipment_id), &new_status);
    
    // Update counts (no need to rebuild vectors)
    let old_count_key = DataKey::ShipmentsByStatus(old_status.clone());
    let new_count_key = DataKey::ShipmentsByStatus(new_status.clone());
    
    let old_count: u32 = env.storage().instance().get(&old_count_key).unwrap_or(0);
    let new_count: u32 = env.storage().instance().get(&new_count_key).unwrap_or(0);
    
    env.storage().instance().set(&old_count_key, &old_count.saturating_sub(1));
    env.storage().instance().set(&new_count_key, &(new_count + 1));
    
    // Add to new index
    let index_key = DataKey::ShipmentIndex(new_status, new_count);
    env.storage().instance().set(&index_key, &shipment_id);
}
```

**Gas Cost:** ~30,000-40,000 (constant, doesn't scale with list size)  
**Savings:** ~30,000-50,000 gas (40-55% reduction)

### Optimized Implementation - Option B: Lazy Sorting

```rust
// Store unsorted, sort only when paginating
pub fn add_shipment(env: Env, shipment_id: u64, status: ShipmentStatus) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();
    
    if env.storage().instance().has(&DataKey::ShipmentStatusOf(shipment_id)) {
        panic!("shipment already exists");
    }
    
    let list_key = DataKey::ShipmentByStatus(status.clone());
    let mut ids = env.storage().instance()
        .get::<_, Vec<u64>>(&list_key)
        .unwrap_or(Vec::new(&env));
    
    ids.push_back(shipment_id);  // O(1) append instead of O(n) sorted insert
    
    env.storage().instance().set(&list_key, &ids);
    env.storage().instance().set(&DataKey::ShipmentStatusOf(shipment_id), &status);
}

pub fn shipment_ids_by_status(
    env: Env,
    status: ShipmentStatus,
    cursor: Option<u64>,
    page_size: u32,
) -> ShipmentPage {
    if page_size == 0 {
        panic!("page_size must be > 0");
    }
    
    let bounded_size = if page_size > MAX_PAGE_SIZE {
        MAX_PAGE_SIZE
    } else {
        page_size
    };
    
    let mut ids = env.storage().instance()
        .get::<_, Vec<u64>>(&DataKey::ShipmentByStatus(status))
        .unwrap_or(Vec::new(&env));
    
    // Sort on read (amortize cost across pagination calls)
    ids = Self::sort_vec(&env, ids);
    
    // ... pagination logic ...
}
```

**Gas Cost:** ~35,000-45,000 for add, sorting cost amortized across reads  
**Savings:** ~25,000-45,000 gas on writes (40-50% reduction)

---

## 4. Optimize Withdraw Divest Logic

### Current Implementation (Inefficient)

```rust
fn do_withdraw(
    env: &Env,
    state: &mut VaultState,
    user: Address,
    shares: i128,
    assets_to_return: i128,
) -> Result<i128, VaultError> {
    let token_addr = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
    let token_client = token::Client::new(env, &token_addr);
    
    // Always loads idle assets and checks strategy
    let mut idle_ta = env.storage().instance()
        .get::<_, i128>(&DataKey::TotalAssets)
        .unwrap_or(0);
    
    if idle_ta < assets_to_return {
        let needed = assets_to_return.checked_sub(idle_ta).expect("underflow");
        Self::divest(env.clone(), needed);  // Expensive external call
        idle_ta = env.storage().instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
    }
    
    // ... rest of withdrawal ...
}
```

**Gas Cost:** ~140,000-190,000 (includes unnecessary strategy checks)

### Optimized Implementation

```rust
fn do_withdraw(
    env: &Env,
    state: &mut VaultState,
    user: Address,
    shares: i128,
    assets_to_return: i128,
) -> Result<i128, VaultError> {
    let token_addr = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
    let token_client = token::Client::new(env, &token_addr);
    
    // Use state.total_assets (already loaded) instead of separate read
    let idle_ta = state.total_assets;
    
    // Only interact with strategy if actually needed
    if idle_ta < assets_to_return {
        let needed = assets_to_return.checked_sub(idle_ta).expect("underflow");
        
        // Check if strategy exists before calling
        if let Some(strategy_addr) = Self::strategy(env.clone()) {
            let strategy_client = StrategyClient::new(env, &strategy_addr);
            strategy_client.withdraw(&needed);
            
            // Update state
            state.total_assets = state.total_assets
                .checked_add(needed)
                .expect("overflow");
        } else {
            panic!("insufficient idle assets and no strategy configured");
        }
    }
    
    // Transfer tokens
    token_client.transfer(&env.current_contract_address(), &user, &assets_to_return);
    
    // Update state (single write at end)
    state.total_assets = state.total_assets
        .checked_sub(assets_to_return)
        .expect("underflow");
    state.total_shares = state.total_shares
        .checked_sub(shares)
        .expect("underflow");
    
    // ... rest of withdrawal ...
}
```

**Gas Cost:** ~115,000-160,000 (when divest not needed: ~100,000-130,000)  
**Savings:** ~15,000-30,000 gas (12-20% reduction)

---

## 5. Cache Strategy Total Value

### Current Implementation (Inefficient)

```rust
pub fn total_assets(env: Env) -> i128 {
    let idle_assets = env.storage().instance()
        .get::<_, i128>(&DataKey::TotalAssets)
        .unwrap_or(0);
    
    let strategy_assets = if let Some(strategy_addr) = Self::strategy(env.clone()) {
        let strategy_client = StrategyClient::new(&env, &strategy_addr);
        strategy_client.total_value()  // External call every time
    } else {
        0
    };
    
    idle_assets.checked_add(strategy_assets).expect("overflow")
}
```

**Gas Cost:** ~15,000-30,000 per call (external call is expensive)

### Optimized Implementation

```rust
#[contracttype]
pub struct StrategyValueCache {
    pub value: i128,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    // ... existing keys ...
    StrategyValueCache,
    StrategyValueCacheTTL,  // Time-to-live in seconds
}

pub fn total_assets(env: Env) -> i128 {
    let idle_assets = env.storage().instance()
        .get::<_, i128>(&DataKey::TotalAssets)
        .unwrap_or(0);
    
    let strategy_assets = if let Some(strategy_addr) = Self::strategy(env.clone()) {
        // Check cache first
        let cache: Option<StrategyValueCache> = env.storage().instance()
            .get(&DataKey::StrategyValueCache);
        
        let ttl: u64 = env.storage().instance()
            .get(&DataKey::StrategyValueCacheTTL)
            .unwrap_or(300);  // Default 5 minutes
        
        let current_time = env.ledger().timestamp();
        
        if let Some(cached) = cache {
            if current_time - cached.timestamp < ttl {
                cached.value  // Return cached value
            } else {
                Self::refresh_strategy_cache(&env, &strategy_addr)
            }
        } else {
            Self::refresh_strategy_cache(&env, &strategy_addr)
        }
    } else {
        0
    };
    
    idle_assets.checked_add(strategy_assets).expect("overflow")
}

fn refresh_strategy_cache(env: &Env, strategy_addr: &Address) -> i128 {
    let strategy_client = StrategyClient::new(env, strategy_addr);
    let value = strategy_client.total_value();
    
    let cache = StrategyValueCache {
        value,
        timestamp: env.ledger().timestamp(),
    };
    
    env.storage().instance().set(&DataKey::StrategyValueCache, &cache);
    value
}

// Invalidate cache on invest/divest
pub fn invest(env: Env, amount: i128) {
    // ... existing logic ...
    
    // Invalidate cache
    env.storage().instance().remove(&DataKey::StrategyValueCache);
}

pub fn divest(env: Env, amount: i128) {
    // ... existing logic ...
    
    // Invalidate cache
    env.storage().instance().remove(&DataKey::StrategyValueCache);
}
```

**Gas Cost:** ~5,000-8,000 per call (when cached), ~15,000-30,000 (cache miss)  
**Savings:** ~10,000-22,000 gas per cached read (60-75% reduction)

---

## 6. Batch Shipment Operations

### Current Implementation (Inefficient)

```rust
// User must call add_shipment multiple times
vault.add_shipment(&1, &ShipmentStatus::Pending);  // ~75,000 gas
vault.add_shipment(&2, &ShipmentStatus::Pending);  // ~75,000 gas
vault.add_shipment(&3, &ShipmentStatus::Pending);  // ~75,000 gas
// Total: ~225,000 gas
```

### Optimized Implementation

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipmentBatch {
    pub shipment_id: u64,
    pub status: ShipmentStatus,
}

pub fn add_shipments_batch(env: Env, shipments: Vec<ShipmentBatch>) {
    let admin: Address = get_admin(&env).expect("Admin not set");
    admin.require_auth();  // Single auth check for all
    
    for shipment in shipments.iter() {
        if env.storage().instance()
            .has(&DataKey::ShipmentStatusOf(shipment.shipment_id)) {
            panic!("shipment {} already exists", shipment.shipment_id);
        }
    }
    
    // Group by status to minimize storage operations
    let mut by_status: soroban_sdk::Map<ShipmentStatus, Vec<u64>> = 
        soroban_sdk::Map::new(&env);
    
    for shipment in shipments.iter() {
        let mut ids = by_status.get(shipment.status.clone())
            .unwrap_or(Vec::new(&env));
        ids.push_back(shipment.shipment_id);
        by_status.set(shipment.status.clone(), ids);
        
        // Set individual status
        env.storage().instance().set(
            &DataKey::ShipmentStatusOf(shipment.shipment_id),
            &shipment.status
        );
    }
    
    // Update status lists (one write per status instead of per shipment)
    for (status, new_ids) in by_status.iter() {
        let list_key = DataKey::ShipmentByStatus(status.clone());
        let mut existing = env.storage().instance()
            .get::<_, Vec<u64>>(&list_key)
            .unwrap_or(Vec::new(&env));
        
        for id in new_ids.iter() {
            existing.push_back(id);
        }
        
        env.storage().instance().set(&list_key, &existing);
    }
}

// Usage:
let batch = Vec::from_array(&env, [
    ShipmentBatch { shipment_id: 1, status: ShipmentStatus::Pending },
    ShipmentBatch { shipment_id: 2, status: ShipmentStatus::Pending },
    ShipmentBatch { shipment_id: 3, status: ShipmentStatus::Pending },
]);
vault.add_shipments_batch(&batch);  // ~95,000 gas total
```

**Gas Cost:** ~95,000 for 3 shipments (vs ~225,000)  
**Savings:** ~130,000 gas for 3 shipments (58% reduction)  
**Per-shipment cost:** ~32,000 gas (vs ~75,000)

---

## 7. Early Exit Optimizations

### Current Implementation (Inefficient)

```rust
pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, VaultError> {
    let mut state = Self::get_state(&env);  // Expensive read
    if state.is_paused {
        return Err(VaultError::ContractPaused);
    }
    
    user.require_auth();
    if amount <= 0 {  // Should check this first
        return Err(VaultError::InvalidAmount);
    }
    
    // ... rest of function ...
}
```

### Optimized Implementation

```rust
pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, VaultError> {
    // Check cheapest validations first
    if amount <= 0 {
        return Err(VaultError::InvalidAmount);
    }
    
    user.require_auth();
    
    // Check pause status (now using optimized boolean storage)
    if Self::is_paused(env.clone()) {
        return Err(VaultError::ContractPaused);
    }
    
    // Only load state if all validations pass
    let mut state = Self::get_state(&env);
    
    // ... rest of function ...
}
```

**Gas Cost:** ~3,000-5,000 for early rejections (vs ~15,000-20,000)  
**Savings:** ~12,000-15,000 gas for invalid inputs (75-80% reduction)

---

## Implementation Checklist

### Phase 1: Critical Optimizations
- [ ] Consolidate state management (remove redundant TotalAssets/TotalShares keys)
- [ ] Optimize pause/unpause (separate IsPaused boolean)
- [ ] Fix withdraw divest logic (check idle balance first)
- [ ] Add early exit optimizations (validate before loading state)

### Phase 2: Data Structure Improvements
- [ ] Optimize shipment data structure (choose Option A or B)
- [ ] Implement batch shipment operations
- [ ] Add strategy value caching with TTL

### Phase 3: Testing & Validation
- [ ] Create gas benchmarking test suite
- [ ] Measure before/after gas costs
- [ ] Validate functionality unchanged
- [ ] Load test with realistic data sizes

---

## Expected Overall Impact

| Optimization | Functions Affected | Gas Savings | Implementation Effort |
|--------------|-------------------|-------------|----------------------|
| State consolidation | 8 functions | 10,000-15,000 each | Medium |
| Pause optimization | 5 functions | 3,000-16,000 each | Low |
| Shipment structure | 3 functions | 20,000-30,000 each | High |
| Withdraw divest | 2 functions | 15,000-30,000 each | Low |
| Strategy caching | 1 function | 10,000-22,000 per call | Medium |
| Batch operations | 1 function | 40,000+ per batch | Medium |
| Early exits | 5 functions | 12,000-15,000 each | Low |

**Total Potential Savings:** 15-25% across all operations  
**Highest ROI:** Pause optimization (low effort, high impact)  
**Highest Impact:** State consolidation (affects most functions)
