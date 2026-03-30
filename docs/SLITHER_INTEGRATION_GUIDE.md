# Slither Integration & False Positive Handling Guide

**For DevOps Engineers and Security Teams**

This document explains how to configure and use Slither with your CI/CD pipeline, including severity policies and false positive suppression.

---

## 📋 Configuration Overview

### File: `slither.config.json`

Our Slither configuration balances **security** with **pragmatism**:

```json
{
  "detectors_to_run": [
    "reentrancy",              // Critical: Eth/delegatecall reentrancy
    "unchecked-transfer",      // Critical: ERC20 transfer failures
    "unchecked-lowlevel",      // Critical: .call() failures
    "uninitialized-state",     // High: Missing initialization
    // ... 20+ additional detectors
  ],
  "exclude": [
    "naming-convention",       // Style issue, not security
    "solc-description",        // Compiler metadata, not security
    "solc-version",           // Version selection, not vulnerability
    "low-level-calls",        // Often necessary for optimization
    "too-many-digits",        // Style issue
    "constable-states"        // Optimization, not security
  ],
  "filter_paths": [
    "node_modules",           // Dependencies already audited
    "lib",                     // External libraries
    "test",                    // Test code, different rules
    "mock"                     // Mock contracts for testing
  ],
  "severity_filter": "medium" // Fail on Medium+, warn on Low
}
```

### Why These Exclusions?

| Excluded | Reason | Example |
|----------|--------|---------|
| `naming-convention` | Style, not security | `myVariable` vs `my_variable` |
| `solc-description` | Compiler metadata | SPDX comment formatting |
| `low-level-calls` | Often necessary for optimization | Delegatecall for proxies |
| `too-many-digits` | Style issue | Large numbers like `1000000000000000000` |
| `constable-states` | Gas optimization | Making constants from static variables |

---

## 🚨 Severity Policy

### Build Blocking (CI/CD Failure)
```
🔴 HIGH severity    → BLOCKS PULL REQUEST
🟠 MEDIUM severity  → BLOCKS PULL REQUEST
```

**Impact**: PRs cannot be merged until findings are resolved or properly documented as false positives.

### Non-Blocking (Warnings)
```
🟡 LOW severity          → LOGGED (non-blocking)
ℹ️  INFORMATIONAL severity → LOGGED (non-blocking)
```

**Impact**: Build passes, but findings are visible in PR comments and GitHub Security tab for team awareness.

### Configuration in Workflow

File: `.github/workflows/slither.yml`

```yaml
- name: Run Slither analysis
  uses: crytic/slither-action@latest
  with:
    fail-on: medium              # ← Key setting
    slither-config: slither.config.json
```

- `fail-on: medium` → Fails on High AND Medium
- `fail-on: high` → Only fails on High (less strict)
- `fail-on: low` → Fails on High, Medium, AND Low (strictest)

---

## 🎯 Suppression Methods

### Method 1: Disable Next Line (Per-Line Suppression) ✅ PREFERRED

Use when a specific line has a false positive or acceptable risk.

```solidity
// slither-disable-next-line detector-name
function risky() external {
    // This line only won't trigger detector-name
}
```

**Example: Reentrancy False Positive**
```solidity
function swap(uint minOutput) external {
    // This call is safe because of our mutex lock
    // slither-disable-next-line reentrancy-eth
    (bool success, bytes memory data) = swapContract.call(
        abi.encodeCall(swap, (path, amountIn, minOutput))
    );
    require(success, string(data));
}
```

**Multiple Detectors:**
```solidity
// slither-disable-next-line reentrancy-eth,unchecked-transfer
(bool success, ) = recipient.call{value: amount}("");
```

### Method 2: Disable Block (Multiple Lines)

Use for sections of code where multiple findings are acceptable.

```solidity
// slither-disable=low-level-calls,assembly
function delegateCall() internal {
    // All assembly and low-level calls in this block are ignored
    assembly {
        // ...
    }
}
// slither-enable=low-level-calls,assembly
// Normal detection resumes here
```

### Method 3: Disable Entire File

Use sparingly for files where suppression is widespread.

```solidity
// slither-disable=naming-convention
// pragma solidity ^0.8.0;

// All naming-convention warnings are suppressed for this file
contract StrangeNamer {
    uint256 myVariable;  // Would normally warn
}
```

### Method 4: Exclude by Configuration (SiteFwide)

Use for detectors/paths that should never be checked.

Edit `slither.config.json`:
```json
{
  "exclude": [
    "naming-convention",    // ← Exclude this detector from ALL files
    "solc-description"
  ],
  "filter_paths": [
    "test",                 // ← Never scan this path
    "mock"
  ]
}
```

---

## 📝 Required Documentation for Suppressions

### Rule 1: Every Suppression Needs a Comment

```solidity
// ❌ BAD: No explanation
// slither-disable-next-line reentrancy-eth
(bool success, ) = target.call("");

// ✅ GOOD: Explains why
// SAFETY: Protected by nonReentrant modifier (mutex lock active)
// See: contracts/.false-positives.md#FP-001
// slither-disable-next-line reentrancy-eth
(bool success, ) = target.call("");
```

### Rule 2: Link to False Positive Registry

All non-trivial suppressions should reference the false positive registry.

```solidity
// slither-disable-next-line unchecked-transfer
// Reason: SafeERC20 wrapper ensures revert on failure
// See: contracts/.false-positives.md#FP-002
IERC20(token).safeTransfer(recipient, amount);
```

### Rule 3: Add Entry to `.false-positives.md`

Every suppressed finding must be documented in the registry.

File: `contracts/.false-positives.md`

```markdown
## [FP-XXX] Brief Title

**Date**: 2024-01-15
**Auditor**: @alice
**Tool**: Slither
**Detector**: reentrancy-eth
**Severity**: High
**Location**: contracts/Vault.sol:123

### Technical Reasoning
This appears to violate the CEI pattern because the external call 
comes before the state update. However, the contract uses a reentrant 
guard (mutex) that prevents the callback from re-entering.

### Code
```solidity
// Line 123
// slither-disable-next-line reentrancy-eth
(bool success, ) = recipient.call{value: amount}("");

// Line 124
balances[msg.sender] -= amount;
```

### Evidence
- Test: `test_reentrancy_protection()` in tests/test_reentrancy.sol
- Guard: nonReentrant modifier from OpenZeppelin

### Approval
Approved by: @security-lead
PR: #567
```

---

## 🔍 Reading Slither Output

### Local Run
```bash
$ slither . --config-file slither.config.json

Slither 0.9.2
/workspace/contracts
.
Contract A
    Function X() (lines X-Y)
        [HIGH] Reentrancy in transferFunds
            An external call is done before state updates were done.
            ...
```

### In GitHub Actions

**Workflow Output**:
```
❌ Build blocked due to High/Medium severity findings

See GitHub Security tab for:
  - SARIF report with all findings
  - Code locations and recommendations
```

**GitHub Security Tab**:
![Visualization showing SARIF report]

**PR Comment**:
```
## 🔍 Slither Static Analysis Results

**Severity Policy:**
- 🔴 High/Medium findings **BLOCK** the build
- 🟡 Low/Informational findings are **LOGGED** (non-blocking)
```

---

## ✅ Checklist: Suppressing a Finding

When you need to suppress a Slither finding as a false positive:

- [ ] **Understand the finding**: Read the detector documentation
- [ ] **Verify it's safe**: Code review why the tool is wrong
- [ ] **Add inline comment**: Explain why it's safe
- [ ] **Reference FP registry**: Link to false positive database
- [ ] **Add FP entry**: Update contracts/.false-positives.md
- [ ] **Get approval**: Have security team review the suppression
- [ ] **Use syntax**: Add proper `// slither-disable-next-line` comment
- [ ] **Test**: Verify the suppressed warning doesn't appear in workflow

---

## 🛠️ Common Suppressions and When to Use Them

### 1. Reentrancy (False Positive)

**When**: Code uses mutex/guard that Slither doesn't detect

```solidity
// ✅ Correct suppression pattern
// SAFETY: Protected by nonReentrant modifier
// FP Reference: see contracts/.false-positives.md#FP-reentrancy
// slither-disable-next-line reentrancy-eth
(bool success, bytes memory data) = target.call(abi.encodeCall(...));
require(success, string(data));
```

### 2. Unchecked Transfer (False Positive)

**When**: Using SafeERC20 wrapper

```solidity
// ✅ SafeERC20 automatically handles failed transfers
// slither-disable-next-line unchecked-transfer
IERC20(token).safeTransfer(recipient, amount);
```

### 3. Low-Level Calls (False Positive)

**When**: Intentional use for optimization or proxy pattern

```solidity
// ✅ Delegatecall in proxy pattern is intentional
// slither-disable-next-line low-level-calls
(bool success, bytes memory data) = impl.delegatecall(
    abi.encodeCall(...)
);
```

### 4. Naming Convention (Excluded)

**When**: Project uses non-standard naming

```solidity
// No suppression needed - already excluded in slither.config.json
uint256 myVariable;  // snake_case vs camelCase
```

---

## 📊 Workflow Integration

### On Pull Request

1. **Developer** submits PR with code changes
2. **GitHub Actions** automatically runs Slither
3. **Slither** scans code against `.github/workflows/slither.yml` config
4. **Results**:
   - 🔴 High/Medium? → Build FAILS, PR cannot merge
   - 🟡 Low/Informational? → Build PASSES, warning in PR comment
5. **Response**:
   - Fix vulnerability, OR
   - Suppress with false positive documentation, OR
   - Escalate to security team

### On Main/Develop Branch

Slither also runs on `push` to main/develop branches to catch any issues in deployments.

```
push to main/develop
    ↓
Slither runs
    ↓
High/Medium found? Email security team
    ↓
Dashboard updated with findings
```

---

## 🚨 Emergency: Disabling Slither

If Slither causes issues and blocks all PRs (last resort):

1. **Temporary**: Comment out job in `.github/workflows/slither.yml`
2. **Required**: File GitHub Issue immediately
3. **Deadline**: Re-enable within 24 hours
4. **Post**: Document root cause

```yaml
# Temporarily disabled due to [issue]
# Re-enable by [date] - GitHub Issue #XXX
# jobs:
#   slither:
#     ...
```

---

## 📞 Support

**Question**: "Should I suppress this finding?"

**Answer**: Run this decision tree:

```
Finding Appears

  ↓ Is it a real vulnerability?
    YES → Fix it
    NO  → Continue

  ↓ Is it a false positive (tool limitation)?
    YES → Document in .false-positives.md + suppress
    NO  → Continue

  ↓ Is it a style/low-priority issue?
    YES → Check if already in exclusions
    NO  → Consult security team (@security-team)
```

---

## 🎓 Reference

- **Slither GitHub**: https://github.com/crytic/slither
- **Detector List**: https://github.com/crytic/slither/wiki/Detector-Documentation
- **Security Checklist**: See [docs/SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)
- **False Positives**: See [docs/FALSE_POSITIVE_HANDLING.md](FALSE_POSITIVE_HANDLING.md)

---

**Last Updated**: 2024-01-15  
**Maintained By**: DevSecOps Team
