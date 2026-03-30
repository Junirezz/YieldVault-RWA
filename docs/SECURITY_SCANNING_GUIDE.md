# Security Scanning Suite - Setup & Usage Guide

Complete guide to our automated security scanning infrastructure for both Ethereum (Solidity) and Soroban (Rust) smart contracts.

---

## 📋 Components

### 1. **Slither for Solidity** (`.github/workflows/slither.yml`)
- Detects common Solidity vulnerabilities (reentrancy, unchecked returns, etc.)
- Configured to fail on **High & Medium severity** issues
- Uploads results to GitHub Security tab (SARIF format)
- Posts PR comments with findings

**Trigger**: Every PR to `main` or `develop`

### 2. **Rust Security Audit** (`.github/workflows/rust-security.yml`)
- `cargo-audit`: Detects vulnerable dependencies
- `cargo-clippy`: Linting and code quality
- `cargo-deny`: Supply chain security checks
- Unsafe code block detection

**Trigger**: Every PR to `main` or `develop`

### 3. **Security Checklist** (`docs/SECURITY_CHECKLIST.md`)
- Manual review checklist for PRs
- Covers reentrancy, access control, overflow, unchecked returns, delegatecall
- Excludes low-severity style issues
- Suppression methods for both Solids and Rust

### 4. **False Positive Documentation** (`docs/FALSE_POSITIVE_HANDLING.md`)
- Standardized process for triaging findings
- Maintains audit trail without losing history
- Test coverage requirements
- Approval workflow

---

## 🚀 Quick Start

### Local Setup

#### Install Slither (Solidity Only)
```bash
pip install slither-analyzer

# Verify installation
slither --version
```

#### Install Cargo Audit (Rust)
```bash
cargo install cargo-audit

# Run locally
cargo audit
```

#### Install Clippy (Rust Linting)
```bash
# Usually included with Rust; ensure you have components
rustup component add clippy

# Run locally
cargo clippy --all-targets
```

### Run Scans Locally Before Committing

#### Slither
```bash
# From project root with Solidity contracts
slither . --config-file slither.config.json

# Or specific file
slither contracts/vault/TheVault.sol
```

#### Cargo Audit
```bash
# From workspace root
cargo audit

# From specific crate
cd contracts/vault
cargo audit
```

#### Clippy
```bash
cargo clippy --all-targets --all-features -- -D warnings
```

---

## 📊 Interpreting Results

### Slither Output

```
INFO:Detectors:
[HIGH] Reentrancy in withdraw() (src/vault.sol)
  - State variable changed after external call
  - Consider reordering operations per CEI pattern

[MEDIUM] Unchecked transfer return (src/token.sol:45)
  - Transfer result not validated
  - Add require() check
```

**Action**:
1. Check [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) for mitigation
2. If legitimate fix needed: make changes
3. If false positive: Document in [FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)

### Cargo Audit Output

```
error: unmatched advisory detected
ADVISORY: Potential buffer overflow in dependency `foo`
   ID: RUSTSEC-2024-1234
   crate: foo@0.1.0
   fix: Upgrade to foobar >= 0.2.0
```

**Action**:
1. Update dependency: `cargo update foo` or edit `Cargo.toml`
2. Rerun: `cargo audit`
3. If unfixable: Document risk in security review

---

## 🔧 Configuration

### Slither Config: `slither.config.json`

**Exclude detectors** (don't run them):
```json
{
  "exclude": [
    "naming-convention",    // Snake vs camelCase (style)
    "low-level-calls",      // assembly usage (often necessary)
    "too-many-digits"       // Large number literals (style)
  ]
}
```

**Exclude specific file paths**:
```json
{
  "filter_paths": ["node_modules", "test", "mock"]
}
```

**Exclude specific functions** (per-function basis):
```json
{
  "exclude_functions": ["AggregatorV3Interface.latestRoundData"]
}
```

**Per-line suppression in code** (Solidity):
```solidity
// slither-disable-next-line reentrancy-eth
function sensitive() external {
    // Code here won't be flagged
}
```

### Update for Your Project

Edit `slither.config.json` to adjust sensitivity:

```json
{
  "detectors_to_run": [
    "reentrancy",
    "unchecked-transfer",
    "uninitialized-state",
    "arbitrary-send"
  ],
  "exclude": [
    "naming-convention",
    "solc-version"
  ],
  "filter_paths": ["node_modules", "test"],
  "fail_on": "high"  // Fail build on High severity
}
```

---

## ⚙️ Workflow Troubleshooting

### Build Fails on Slither

**Symptom**: Even after fixing code, Slither still fails

**Solutions**:
1. **Clear cache**: GitHub Actions auto-clears, but locally:
   ```bash
   rm -rf ~/.slither_cache
   slither . --config-file slither.config.json
   ```

2. **Check compilation errors first**: Slither needs valid Solidity
   ```bash
   solc --version  # Ensure correct compiler
   ```

3. **Review exclusions**: Confirm `slither.config.json` is updated

### Compilation Errors in Workflow

**Symptom**: "Compilation error" in GitHub Actions

**Workflow handles this** with:
```yaml
- name: Install dependencies
  run: |
    npm install
    npm run build 2>/dev/null || true  # Don't fail on build errors
```

This allows Slither to run analysis even if your project doesn't compile (e.g., during development).

### False Positive Not Being Excluded

**Symptom**: Same finding keeps appearing in PR checks

**Verification**:
1. Check finding is in `slither.config.json` exclusion list
2. Restart GitHub Actions (push empty commit or rerun workflow)
3. Ensure file path in config matches actual path

---

## 📨 PR Integration

### Automatic Checks

Every PR to `main` or `develop` runs:
1. ✅ Slither analysis
2. ✅ Cargo audit
3. ✅ Clippy linting
4. ✅ Comments PR with summary

### Manual Review Checklist

Reviewers must use [SECURITY_CHECKLIST.md](../docs/SECURITY_CHECKLIST.md):

```markdown
## Security Review ✓
- [x] Reentrancy checks passed
- [x] Access control verified
- [x] Overflow/underflow safe for Solidity <0.8.0
- [x] External calls have return checks
- [x] No dangerous delegatecall
```

### False Positive Approval

If code is flagged but safe:
1. Document in [FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)
2. Link PR comment to FP document
3. Require security team approval
4. Update `slither.config.json` for next time

---

## 📝 Suppression Examples

### Solidity: Suppress Next Line
```solidity
// slither-disable-next-line reentrancy-eth
(bool success, ) = recipient.call{value: amount}("");
```

### Solidity: Suppress Function
```solidity
// slither-disable=unchecked-transfer,arbitrary-send
function unstableTransfer() external {
    // Multiple issues suppressed here
}
```

### Solidity: Suppress File
```solidity
// slither-disable=naming-convention
// pragma solidity ^0.8.0;
// All naming-convention issues suppressed in this file
```

### Rust: Suppress Clippy
```rust
#[allow(clippy::too_many_arguments)]
pub fn complex_function(arg1: u32, arg2: u32, ...) {
    // Clippy warning suppressed
}
```

### Rust: Suppress for Module
```rust
#![allow(clippy::unsafe_code)]

pub mod network_calls {
    // All unsafe_code warnings suppressed in this module
}
```

---

## 🔐 Security Best Practices

### Do ✅
- **Test security fixes**: Add test cases to `tests/test_security.rs`
- **Document decisions**: Update `FALSE_POSITIVE_HANDLING.md`
- **Review tool output**: Don't blindly exclude findings
- **Keep dependencies updated**: Run `cargo audit` regularly
- **Link to checklist**: Reference `SECURITY_CHECKLIST.md` in PRs

### Don't ❌
- **Suppress real vulnerabilities**: Fix instead of hiding
- **Skip security reviews**: Checklists are mandatory
- **Use vague suppression messages**: Be specific
- **Leave TODOs without tracking**: Open GitHub issues instead
- **Disable entire detectors**: Use fine-grained exclusions

---

## 🚨 Emergency: Disabling Checks

### Temporary Disable (Last Resort)

If a workflow is blocking legitimate development:

1. **Comment out job temporarily**:
```yaml
# jobs:
#   slither:
#     ...
```

2. **Always file an issue**: Required before merge
3. **Re-enable before main branch**: Never commit with checks disabled
4. **Document in PR**: Explain why temporary disable was needed

---

## 📚 References & Resources

| Resource | Link | Notes |
|----------|------|-------|
| Slither Docs | https://github.com/crytic/slither | Detector documentation |
| Cargo Audit | https://github.com/rustsec/cargo-audit | Vulnerability database |
| Solidity Best Practices | https://solidity.readthedocs.io/en/latest/security-considerations.html | Ethereum standards |
| Soroban Security | https://developers.stellar.org/docs/smart-contracts/best-practices | Rust/Soroban patterns |
| OWASP Rust | https://cheatsheetseries.owasp.org/cheatsheets/Rust_Security_Cheat_Sheet.html | Rust security tips |

---

## 🆘 Support & Questions

- **Security finding unclear?** → Check [SECURITY_CHECKLIST.md](../docs/SECURITY_CHECKLIST.md)
- **Marking as false positive?** → Follow [FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)
- **Workflow failing?** → See Troubleshooting section above
- **Need security review?** → Tag `@security-team` in PR

---

**Setup Date**: 2024-01-15
**Last Updated**: 2024-01-15
**Maintained By**: DevSecOps Team
