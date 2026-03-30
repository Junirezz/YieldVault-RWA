# Slither False Positive Suppression - Developer Quick Guide

**TL;DR**: How to suppress Slither findings in your Solidity code

---

## When You Get a Slither Finding You Disagree With

### Step 1: Understand the Finding

```bash
$ slither . --config-file slither.config.json

[MEDIUM] Unchecked Transfer in mint()
    returnvalue at contracts/MyToken.sol:45

Recommendation:
    Check the return value of transfer.
```

### Step 2: Analyze Your Code

```solidity
// Line 45 in contracts/MyToken.sol
IERC20(token).transfer(recipient, amount);
```

**Question**: Is this actually risky?

- ✅ YES, risky? → **Fix it**: Add `require()`
- ❌ NO, it's safe? → **Suppress it**: Use `// slither-disable-next-line`

---

## Suppression Syntax

### Single Detector (Most Common)

```solidity
// slither-disable-next-line detector-name
your_code_here();
```

**Example**:
```solidity
// slither-disable-next-line unchecked-transfer
IERC20(token).safeTransfer(recipient, amount);
```

### Multiple Detectors

```solidity
// slither-disable-next-line detector1,detector2,detector3
your_code_here();
```

**Example**:
```solidity
// slither-disable-next-line low-level-calls,assembly
assembly {
    // ...
}
```

### Multi-Line Block

```solidity
// slither-disable=detector-name
function complexFunction() external {
    // Everything here ignores this detector
    ...
}
// slither-enable=detector-name
```

### Disable for File

```solidity
// slither-disable=naming-convention
// pragma solidity ^0.8.0;

// All code in this file ignores naming-convention
contract Foo {
    ...
}
```

---

## Common Suppressions (Copy-Paste Ready)

### 1. SafeERC20 Transfer (Already Safe)

```solidity
// Reason: SafeERC20 wrapper reverts on failure, no check needed
// slither-disable-next-line unchecked-transfer
IERC20(token).safeTransfer(recipient, amount);
```

### 2. Protected Reentrancy (Mutex Guard)

```solidity
// Reason: Protected by nonReentrant guard (mutex mode)
// slither-disable-next-line reentrancy-eth
(bool success, ) = recipient.call{value: amount}("");
require(success, "Failed");
```

### 3. Delegatecall Proxy (Intentional)

```solidity
// Reason: Delegatecall to implementation in proxy pattern is intentional
// slither-disable-next-line low-level-calls
(bool success, bytes memory data) = impl.delegatecall(
    abi.encodeCall(...)
);
```

### 4. Custom Safe Transfer (Audited)

```solidity
// Reason: Custom transfer wrapper has internal safety checks (see SafeTransfer.sol)
// slither-disable-next-line unchecked-transfer
token.customSafeTransfer(to, amount);
```

### 5. Assembly Optimization (Necessary)

```solidity
// Reason: Assembly required for gas optimization; safety checked externally
// slither-disable-next-line assembly
assembly {
    // ...
}
```

---

## The 3-Line Rule

**Every suppression needs 3 things**:

```solidity
// 1. Explain why it's safe (one line)
// Reason: Protected by nonReentrant modifier

// 2. Reference false positive database
// See: contracts/.false-positives.md#FP-001

// 3. Disable detector
// slither-disable-next-line reentrancy-eth
code_here();
```

**Complete example**:
```solidity
function withdraw(uint256 amount) external nonReentrant {
    balances[msg.sender] -= amount;
    
    // Reason: CEI pattern + nonReentrant guard prevents reentrancy
    // See: contracts/.false-positives.md#FP-001
    // slither-disable-next-line reentrancy-eth
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Withdrawal failed");
}
```

---

## Finding the Right Detector Name

### Common Detectors (Copy-Paste These)

| Finding | Detector Name | When to Suppress |
|---------|---------------|-----------------|
| Reentrancy | `reentrancy-eth` | Protected by guard/mutex |
| Unchecked Transfer | `unchecked-transfer` | Using SafeERC20 or custom wrapper |
| Unchecked Low-Level | `unchecked-lowlevel` | Return value checked next line |
| Uninitialized State | `uninitialized-state` | Set in constructor/initializer |
| Delegatecall | `low-level-calls` | Proxy pattern (intentional) |
| Assembly | `assembly` | Optimization (with safety review) |
| Locked Ether | `locked-ether` | Receive function exists |
| Access Control | `public-function` | Protected by other mechanisms |
| Naming Convention | `naming-convention` | *(Already excluded in config)* |
| Too Many Digits | `too-many-digits` | *(Already excluded in config)* |

---

## Step-by-Step: Suppress a Finding

### 1. Run Slither Locally

```bash
slither . --config-file slither.config.json
```

Output:
```
[HIGH] Reentrancy in swap()
    External call at SomeContract.sol:89
```

### 2. Review the Code

```solidity
// Line 89
(bool success, ) = swapContract.call(abi.encodeCall(...));
```

### 3. Add Suppression

```solidity
// Protected by mutex lock in contract
// slither-disable-next-line reentrancy-eth
(bool success, ) = swapContract.call(abi.encodeCall(...));
```

### 4. Document in Registry

**File**: `contracts/.false-positives.md`

Add entry:
```markdown
## [FP-001] Reentrancy in swap()

**Date**: 2024-01-15
**Detector**: reentrancy-eth
**Location**: SomeContract.sol:89
**Reason**: Protected by nonReentrant modifier
**Evidence**: nonReentrant guard prevents re-entry
```

### 5. Run Slither Again

```bash
slither . --config-file slither.config.json
# ✓ Finding is now suppressed
```

### 6. Push PR

Your PR comment will show:
```
✓ Slither: No High/Medium findings
  (1 Low finding suppressed: FP-001)
```

---

## Detectors by Severity

### 🔴 HIGH SEVERITY (These will block your build)

Never suppress HIGH findings without:
1. Security team review
2. Comprehensive test case
3. Multiple reviewers

```
- reentrancy-eth
- unprotected-upgrade
- arbitrary-send-erc20
- suicidal
- uninitialized-state
```

### 🟠 MEDIUM SEVERITY (These will block your build)

Must document false positives with reasoning:

```
- unchecked-transfer
- unchecked-lowlevel
- erc20-interface
- locked-ether
- shadowing-state
```

### 🟡 LOW SEVERITY (These warn but don't block)

May suppress after documentation:

```
- solc-version
- assembly
- low-level-calls
- var-read-using-this
```

---

## What NOT to Suppress

❌ **Never suppress**:
- Real vulnerabilities (fix instead)
- Findings you don't understand (ask team)
- Missing access controls (add them)
- Unvalidated inputs (validate them)

✅ **OK to suppress**:
- Tool limitations it can't understand
- Safe patterns (SafeERC20, guards)
- Intentional design (optimization)
- Style issues (already excluded)

---

## Check Your Work

### Before Submitting PR

```bash
# Run Slither
slither . --config-file slither.config.json

# Verify suppressions work
# (Finding should disappear or show as suppressed)

# Check false positive registry
cat contracts/.false-positives.md

# Review inline comments
grep -r "slither-disable" contracts/
```

### In GitHub Actions

Your PR will show:
```
✓ Slither Analysis Complete
  High/Medium: ✅ (suppressed with FP-001)
  Low: 1 finding logged
  See: Security tab for details
```

---

## Need Help?

| Question | Answer |
|----------|--------|
| "What's the detector name?" | Check [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md#slither-detection) table |
| "How do I suppress multiple?" | Use: `// slither-disable-next-line detector1,detector2` |
| "Can I disable for whole file?" | Yes: `// slither-disable=naming-convention` at top |
| "What if I'm wrong?" | Security team will ask for evidence in PR review |
| "Where do I document this?" | in `contracts/.false-positives.md` as described |

---

## Template for PR Comments (When Suppressing)

Copy-paste this when you suppress a finding:

```markdown
### Security finding suppression: [FP-###]

**Finding**: [Detector name]
**Location**: [File:line]
**Why it's safe**: [2-3 sentence explanation]
**Evidence**: [Code reference, test, or doc reference]
**False Positive Registry**: contracts/.false-positives.md#FP-###
```

---

## Advanced: Bulk Suppress a Block

If you have multiple issues in one area:

```solidity
// slither-disable=reentrancy-eth,low-level-calls,assembly
function complexNativeSwap() internal {
    // All three detectors are suppressed here
    assembly {
        // ...
    }
    (bool success, ) = target.call(...);
}
// slither-enable=reentrancy-eth,low-level-calls,assembly
// Normal detection resumes
```

---

## Examples in This Repo

Look for `// slither-disable-next-line` in codebase:

```bash
grep -r "slither-disable" contracts/
```

See documented false positives in:
```bash
cat contracts/.false-positives.md
```

---

**🎯 Remember**: Suppression = documentation + code comment + security approval

Questions? Tag `@security-team` in your PR!

---

**Last Updated**: 2024-01-15  
**For Details**: See [SLITHER_INTEGRATION_GUIDE.md](SLITHER_INTEGRATION_GUIDE.md)
