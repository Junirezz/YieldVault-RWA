# Smart Contract Security Checklist

**For use during code reviews and PR preparation. Mandatory for all smart contract changes.**

---

## How to Use This Checklist

1. **Before submitting a PR**: Review your code against sections 1-5 below
2. **During code review**: Use this as a framework for security-focused review
3. **For false positives**: Follow the **Triage Process** (Section 6) to document why a finding is safe
4. **For inline suppression**: Use `//slither-disable-next-line` comments with this checklist as reference

---

## 1. Reentrancy Vulnerabilities

**Risk**: External function calls can allow attackers to re-enter the contract and drain funds or manipulate state.

### Checks-Effects-Interactions (CEI) Pattern

All state-changing functions must follow this order:
1. **Checks**: Validate all inputs and conditions
2. **Effects**: Update internal contract state
3. **Interactions**: Make external calls last

#### ✅ CORRECT PATTERN
```solidity
function withdraw(uint256 amount) external {
    // CHECKS: Validate the withdrawal
    require(amount <= balances[msg.sender], "Insufficient balance");
    
    // EFFECTS: Update state BEFORE external call
    balances[msg.sender] -= amount;
    
    // INTERACTIONS: External call comes last
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Withdrawal failed");
}
```

#### ❌ VULNERABLE PATTERN
```solidity
function withdraw(uint256 amount) external {
    // ❌ BAD: External call (interaction) BEFORE state update (effect)
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Withdrawal failed");
    
    balances[msg.sender] -= amount;  // Attacker can re-enter here!
}
```

### Checklist for Reentrancy

- [ ] All `call()`, `delegatecall()`, `transfer()`, `send()` are last in the function
- [ ] State variables are updated BEFORE external calls
- [ ] No callback functions that could re-enter state-changing operations
- [ ] For ERC20/ERC721 interactions: Check return values and handle reentrancy scenarios
- [ ] Consider using mutex pattern if complex logic requires multiple external calls:
  ```solidity
  bool private locked;
  
  modifier nonReentrant() {
      require(!locked, "No reentrancy");
      locked = true;
      _;
      locked = false;
  }
  
  function withdraw() external nonReentrant { ... }
  ```

**Slither Detection**: `reentrancy-eth`, `reentrancy-benign`

---

## 2. Access Control Vulnerabilities

**Risk**: Sensitive functions callable by unauthorized users, leading to fund theft or state manipulation.

### Ownable Pattern (Single Admin)

```solidity
// ✅ CORRECT: Inherit from Ownable and use modifier
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyContract is Ownable {
    function pause() external onlyOwner {
        // Only owner can call
    }
}

// ❌ WRONG: Don't re-implement Ownable manually
contract BadContract {
    address owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    // Forgot to check owner! Anyone can call!
    function pause() external {
        paused = true;
    }
}
```

### Role-Based Access Control (Multiple Admin Levels)

```solidity
// ✅ CORRECT: Use AccessControl for multiple roles
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/access/AccessControl.sol";

contract MyContract is AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        // Only MINTER_ROLE can call
    }
    
    function setRole(address user) external onlyRole(ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, user);
    }
}
```

### Checklist for Access Control

- [ ] All admin/privileged functions use `onlyOwner`, `onlyRole()`, or equivalent guards
- [ ] Admin initialization is correct: `owner = msg.sender` in constructor (or use Ownable)
- [ ] Role initialization: Verify `_grantRole()` is called for initial admins
- [ ] No public or external functions that should be protected:
  - State-changing operations (mint, burn, pause, withdraw)
  - Parameter updates (fee, threshold, strategy address)
  - Role/permission changes
- [ ] For proxies: Is `__Ownable_init()` or `__AccessControl_init()` called? (not just constructor)
- [ ] No role confusion: Users can't grant themselves higher privileges
- [ ] Role revocation: Can admins remove dangerous roles if needed?

**Slither Detection**: `public-function-inherited-from-private`, `uninitialized-state`

**Pattern**: Prefer `AccessControl` over custom role systems

---

## 3. Input Validation Vulnerabilities

**Risk**: Unchecked inputs allow invalid data to corrupt contract state or enable attacks.

### Common Input Validation Gaps

```solidity
// ❌ VULNERABLE: No input validation
function setFee(uint256 newFee) external onlyOwner {
    fee = newFee;  // What if newFee = 100%? Or 0?
}

// ✅ CORRECT: Validate bounds
function setFee(uint256 newFee) external onlyOwner {
    require(newFee > 0, "Fee must be positive");
    require(newFee <= 100, "Fee cannot exceed 100%");
    fee = newFee;
}

// ❌ VULNERABLE: No address validation
function setTreasury(address newTreasury) external onlyOwner {
    treasury = newTreasury;  // What if newTreasury = address(0)?
}

// ✅ CORRECT: Validate address
function setTreasury(address newTreasury) external onlyOwner {
    require(newTreasury != address(0), "Treasury cannot be zero address");
    treasury = newTreasury;
}
```

### Checklist for Input Validation

- [ ] All parameters have bounds checking:
  - Numbers: Not zero (if not allowed), not > max, not < min
  - Addresses: Not zero address for critical operations
  - Arrays: Not empty (if required), length reasonable
- [ ] Math operations checked:
  ```solidity
  // Prevent division by zero
  require(denominator != 0, "Division by zero");
  uint256 result = numerator / denominator;
  
  // For Solidity <0.8.0: Check overflow with SafeMath
  ```
- [ ] No off-by-one errors:
  ```solidity
  // Check both boundaries
  require(index > 0 && index < array.length, "Index out of bounds");
  ```
- [ ] Function parameters validated before use:
  - Slippage tolerance in swaps
  - Deadline in time-dependent operations
  - Min/max amounts

**Slither Detection**: None directly, but often co-located with unchecked-transfer, integer-overflow

---

## 4. Unchecked Return Values

**Risk**: External calls fail silently; funds are "transferred" without actually moving.

### ERC20 Transfer Pattern

```solidity
// ❌ VULNERABLE: No return value check
IERC20(token).transfer(recipient, amount);
// If transfer fails, execution continues!

// ✅ CORRECT: Check return value
require(
    IERC20(token).transfer(recipient, amount),
    "Transfer failed"
);

// ✅ OR: Use safe wrapper
IERC20(token).safeTransfer(recipient, amount);
```

### Low-Level Call Pattern

```solidity
// ❌ VULNERABLE: Success flag ignored
(bool success, ) = recipient.call{value: amount}("");
// Execution continues even if call failed!

// ✅ CORRECT: Check success
(bool success, ) = recipient.call{value: amount}("");
require(success, "Call failed");

// ✅ BETTER: Reject on failure with error message
(bool success, bytes memory data) = recipient.call{value: amount}("");
require(success, string(data));
```

### Checklist for Unchecked Returns

- [ ] All `transfer()` calls on ERC20 have `require()` check
- [ ] All `transferFrom()` calls have `require()` check
- [ ] All `call()` return values checked with `require(success, ...)`
- [ ] `send()` and `transfer()` return values checked (they return bool)
- [ ] Safe wrapper functions used when available:
  ```solidity
  import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
  using SafeERC20 for IERC20;
  
  IERC20(token).safeTransfer(to, amount);  // Reverts on failure
  ```
- [ ] No array operations that fail silently (e.g., `.pop()` on empty array)

**Slither Detection**: `unchecked-transfer`, `unchecked-send`, `unchecked-lowlevel`

---

## 5. Gas Limit & Denial of Service Vulnerabilities

**Risk**: Transactions fail due to gas limits, or users are locked out due to loops/state bloat.

### Unbounded Loop Vulnerability

```solidity
// ❌ VULNERABLE: Loop with no bounds
function distributeRewards(address[] memory users) external {
    for (uint256 i = 0; i < users.length; i++) {
        users[i].transfer(...);  // 10,000 users = out of gas!
    }
}

// ✅ CORRECT: Batch with pagination
function distributeRewards(
    address[] memory users,
    uint256 startIdx,
    uint256 endIdx
) external {
    require(endIdx - startIdx <= 100, "Batch too large");
    for (uint256 i = startIdx; i < endIdx; i++) {
        users[i].transfer(...);
    }
}

// Users call multiple times:
// - distributeRewards(users, 0, 100)
// - distributeRewards(users, 100, 200)
// - etc.
```

### Checklist for Gas Limits & DoS

- [ ] No unbounded loops over external data (user arrays, etc.)
- [ ] Long loops broken into batches:
  ```solidity
  require(items.length <= MAX_BATCH_SIZE, "Batch size exceeded");
  ```
- [ ] No `delegatecall()` in loops (extremely expensive)
- [ ] State storage is bounded:
  - No growing arrays that users control size of
  - `mapping` with limit checks if acting as queue
- [ ] No operations dependent on contract balance that could increase unboundedly
- [ ] For `for` loops: Always have clear upper bound or external pagination

**Slither Detection**: `controlled-array-length`

**Pattern**: Use "pull over push" to avoid loops:
```solidity
// ❌ PUSH: Loop over users and send to each
function distributeAll() external {
    for (uint i = 0; i < users.length; i++) {
        send(users[i]);  // DOS risk
    }
}

// ✅ PULL: Each user withdraws their own amount
function withdraw() external {
    uint256 owed = calculateOwed(msg.sender);
    msg.sender.transfer(owed);
}
```

---

## 6. Triage Process: Documenting False Positives

**When a Slither/security tool finding is NOT actually vulnerable, document it.**

### Rationale Format (Required Fields)

Use this format when suppressing a finding or marking as known false positive:

```
## [FP-XXX] Finding Title

**Date Reviewed**: 2024-01-15
**Reviewed By**: @auditor-name (your GitHub handle)
**Tool**: Slither
**Detector Rule**: reentrancy-eth
**Severity**: High
**Location**: contracts/MyContract.sol:123

### Technical Reasoning

[Explain WHY this is safe]

Example: "This function uses a mutex lock (nonReentrant modifier) that prevents 
re-entry before the external call at line 125. The attack vector requires the 
external contract to call back into this contract while the lock is held, which 
is impossible."

### Evidence

- Test coverage: `tests/test_reentrancy.sol` line 45
- Pattern: Standard mutex (from OpenZeppelin)
- No callback vector identified after code review

### Suppression Method

Use in code:
```solidity
// slither-disable-next-line reentrancy-eth
(bool success, ) = recipient.call{value: amount}("");
```

### Approval

Approved by: @security-lead
PR: #1234
```

### Example False Positive Documentation

```markdown
## [FP-001] Low-Level Calls in External Contract

**Date Reviewed**: 2024-01-15
**Reviewed By**: @alice (contract auditor)
**Tool**: Slither
**Detector Rule**: low-level-calls
**Severity**: Low
**Location**: contracts/Swap.sol:89

### Technical Reasoning

This finding flags the use of `.call()` without checking the return value. 
However, the code immediately checks the return value on the next line 
via `require(success, ...)`. This is a false positive because:

1. The success flag IS checked (line 90)
2. Return data IS handled with error reporting
3. The detector appears to flag `.call()` usage without looking ahead

### Evidence

```solidity
// Line 89
(bool success, bytes memory data) = target.call(abi.encodeCall(...));
// Line 90 - CHECKS RETURN VALUE
require(success, string(data));
```

### Approval

Approved by: @security-team-lead
Link: https://github.com/org/repo/pull/567#review-123456
```

### Checklist for False Positive Documentation

- [ ] **Date**: When was this reviewed? (YYYY-MM-DD)
- [ ] **Auditor**: Who confirmed it's safe? (@handle)
- [ ] **Tool & Detector**: Which tool and which rule flagged it?
- [ ] **Location**: File path and line number
- [ ] **Technical Reasoning**: 3+ sentences explaining why it's safe
- [ ] **Evidence**: Code snippet, test case, or reference showing safety
- [ ] **Approval**: Who approves suppressing this? Tag them in PR
- [ ] **Suppression Comment**: Inline comment in code with reason

---

## 7. Inline Suppression Syntax

### Suppress a Single Line (Solidity)

```solidity
// slither-disable-next-line detector-name
function risky() external {
    // This line won't trigger 'detector-name'
}
```

### Suppress Multiple Lines (Solidity)

```solidity
// slither-disable=detector1,detector2
function complexOp() external {
    // All code here is exempt from detector1 and detector2
    ...
}
// slither-enable=detector1,detector2
function safe() external {
    // Now normal detection resumes
}
```

### Suppress Entire File (Solidity)

```solidity
// slither-disable=naming-convention
// pragma solidity ^0.8.0;
// All naming-convention warnings suppressed for this file
```

### Enable a Detector Globally (in Workflow)

Edit `.github/workflows/slither.yml`:
```yaml
- name: Run Slither analysis
  uses: crytic/slither-action@latest
  with:
    # Exclude these detectors from scanning (permanently)
    exclude: "naming-convention,solc-version"
```

---

## 8. Quick Reference: Common Patterns

| Vulnerability | Pattern | Fix | Slither Rule |
|---|---|---|---|
| Reentrancy | Call before state update | CEI pattern | reentrancy-eth |
| Unchecked Call | `.call()` without check | `require(success, ...)` | unchecked-lowlevel |
| Access Gap | No `onlyOwner` | Add access modifier | public-function / uninitialized-state |
| Overflow (0.8+) | Math without bounds | Add `require()` bounds | N/A* |
| ERC20 Transfer | No return check | `require(success, ...)` or SafeERC20 | unchecked-transfer |
| Unbounded Loop | `for (i=0; i<arr.length; ...)` | Pagination / batch limits | controlled-array-length |

*Solidity 0.8.0+ has built-in overflow protection; add checks only if needed

---

## 9. Submitting PRs with This Checklist

**Required in all smart contract PRs:**

```markdown
## Security Review
- [x] Reentrancy: Verified CEI pattern
- [x] Access Control: Only authorized functions exposed
- [x] Input Validation: All params bounded
- [x] Unchecked Returns: All external calls checked
- [x] Gas Limits: No unbounded loops
- [x] Ran Slither: $ slither . results in ✅ or documented false positives (see FP-XXX)
- [x] Read SECURITY_CHECKLIST.md
```

---

## 10. References & Resources

- **Slither Docs**: https://github.com/crytic/slither
- **OpenZeppelin Patterns**: https://github.com/OpenZeppelin/openzeppelin-contracts
- **Checks-Effects-Interactions**: https://docs.soliditylang.org/en/latest/security-considerations.html#re-entrancy
- **OWASP Smart Contract Security**: https://cheatsheetseries.owasp.org
- **Internal Documentation**: See [FALSE_POSITIVE_HANDLING.md](FALSE_POSITIVE_HANDLING.md)

---

**Last Updated**: 2024-01-15  
**Maintained By**: Security Team  
**Next Review**: Quarterly
