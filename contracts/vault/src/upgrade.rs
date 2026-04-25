use soroban_sdk::{contracttype, Address, BytesN, Env};

/// Storage keys for the Proxy's unstructured storage.
/// We use hashed slots to avoid collisions with the implementation's storage.
/// EIP-1967 style slots for WASM.
#[contracttype]
pub enum ProxyDataKey {
    /// keccak256("contract.proxy.admin") - 1
    Admin = 0,
    /// keccak256("contract.proxy.implementation") - 1
    Implementation = 1,
    /// keccak256("contract.proxy.initialized") - 1
    Initialized = 2,
    /// keccak256("contract.proxy.pending_admin") - 1
    PendingAdmin = 3,
}

/// Constant for the implementation slot using a non-overlapping hash.
/// bytes32(uint256(keccak256("contract.proxy.implementation")) - 1)
pub const IMPLEMENTATION_SLOT: [u8; 32] = [
    0x36, 0x08, 0x94, 0xa1, 0x3b, 0xa1, 0xa3, 0x21, 0x06, 0x67, 0xc8, 0x28, 0x49, 0x2d, 0xb9, 0x8d,
    0xca, 0x3e, 0x20, 0x76, 0xcc, 0x37, 0x35, 0xa9, 0x20, 0xa3, 0xca, 0x50, 0x5d, 0x38, 0x2b, 0xbb,
];

/// Constant for the admin slot.
/// bytes32(uint256(keccak256("contract.proxy.admin")) - 1)
pub const ADMIN_SLOT: [u8; 32] = [
    0xb5, 0x31, 0x27, 0x68, 0x4a, 0x56, 0x8b, 0x31, 0x73, 0xae, 0x13, 0xb9, 0xf8, 0xa6, 0x01, 0x6e,
    0x24, 0x3e, 0x61, 0x44, 0x1d, 0x34, 0x11, 0xc9, 0x7d, 0xcd, 0xa2, 0x4c, 0x09, 0xc0, 0xbb, 0x66,
];

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&ProxyDataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ProxyDataKey::Admin, admin);
}

pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&ProxyDataKey::PendingAdmin)
}

pub fn set_pending_admin(env: &Env, admin: &Option<Address>) {
    if let Some(addr) = admin {
        env.storage().instance().set(&ProxyDataKey::PendingAdmin, addr);
    } else {
        env.storage().instance().remove(&ProxyDataKey::PendingAdmin);
    }
}

pub fn get_implementation(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&ProxyDataKey::Implementation)
}

pub fn set_implementation(env: &Env, wasm_hash: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&ProxyDataKey::Implementation, wasm_hash);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&ProxyDataKey::Initialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&ProxyDataKey::Initialized, &true);
}
