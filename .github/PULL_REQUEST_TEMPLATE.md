# Pull Request Template

## 📋 Description
<!-- Provide a clear, concise summary of the goal and changes in this PR -->

### Goal
<!-- What problem does this solve? Reference issue: Closes #123 -->

### Changes
<!-- Bullet points explaining the key modifications -->
- 

## 🔗 Type of Change
- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] ⚠️ Breaking change (fix or feature that would cause existing functionality to change)
- [ ] 🌊 Wave submission (contract migration, architectural wave release, or protocol upgrade)
- [ ] 📚 Documentation update
- [ ] 🔒 Security improvement
- [ ] ⚡ Performance optimization

---

## 🛡️ Risk Assessment

<!-- Mandatory for all PRs to evaluate blast radius, particularly contract migrations & Wave submissions -->

### Risk Level
- [ ] 🟢 **Low**: Non-breaking change, documentation, style, or isolated helper refactoring
- [ ] 🟡 **Medium**: API enhancement, frontend workflow update, non-critical dependency upgrade
- [ ] 🟠 **High**: Core contract logic change, access control modification, financial accounting / share math
- [ ] 🔴 **Critical**: Wave submission, contract storage migration, protocol upgrade touching vault funds

### Blast Radius & Impact Analysis
- [ ] Contract storage layout / data key migration involved
- [ ] Value transfer, deposit/withdraw flow, or vault share calculation affected
- [ ] External integration (Oracle, Soroban RPC, Bridge, Token contract) affected
- [ ] Database schema migration or data backfill required
- [ ] Breaking API or interface change affecting downstream clients
- [ ] Zero blast radius (isolated tooling / documentation only)

**Detailed Risk & Blast Radius Notes:**
<!-- Describe specific failure modes, edge cases, affected components, and risk mitigations -->
```
```

---

## 🔄 Rollback Plan

<!-- Detail the exact steps and strategy to revert this change if unexpected failures occur in production -->

### Rollback Strategy & Feasibility
- [ ] **Clean Git Revert**: Revertable with zero persistent state drift
- [ ] **Contract Upgrade Rollback**: Tested rollback to previous contract WASM hash / implementation
- [ ] **Database Migration Revert**: Reversible migration down-script tested and verified
- [ ] **Feature Flag / Circuit Breaker**: Feature can be toggled off instantly without redeployment
- [ ] **Emergency Pause**: Contract pause / freeze mechanism available to halt affected functions
- [ ] **Forward-Only / Irreversible**: State migration cannot be cleanly reversed; emergency recovery runbook linked below

### Rollback Trigger Criteria
<!-- What specific conditions, metrics, or alerts will trigger an immediate rollback? (e.g. error rate > 1%, oracle divergence, tx reverts) -->
- 

### Step-by-Step Rollback Procedure
<!-- List the exact operational sequence required to execute a rollback -->
1. 
2. 
3. 

---

## ⚡ Performance Impact

<!-- Evaluate gas usage, execution compute units, latency, throughput, and bundle size impact -->

### Performance & Resource Assessment
- [ ] Smart contract gas / compute units benchmarked (no regression > 5%, or justified below)
- [ ] Backend API latency (p95/p99) and database query execution plans verified
- [ ] Database indexing verified for newly queried columns (no table scans)
- [ ] Frontend bundle size and Time to Interactive (TTI) verified
- [ ] Memory allocation and leak checks verified (no memory leaks in long-running services)
- [ ] No measurable performance impact (documentation, tests, or trivial changes)

**Performance & Gas Profiling Summary:**
<!-- Include before/after gas consumption numbers, query explain plans, or benchmark output -->
```
```

---

## 🔒 SECURITY REVIEW (⭐ MANDATORY FOR SMART CONTRACT CHANGES)

**For all smart contract code changes, complete the following checklist.**

See [`docs/SECURITY_CHECKLIST.md`](/docs/SECURITY_CHECKLIST.md) for detailed guidance.

### Required: Security Checklist Sign-Off
- [ ] **I have reviewed this PR against the Internal Security Checklist** (`docs/SECURITY_CHECKLIST.md`)
  - [ ] Reentrancy: Verified Checks-Effects-Interactions (CEI) pattern
  - [ ] Access Control: Confirmed all sensitive functions are protected (`onlyOwner`, `onlyRole()`, etc.)
  - [ ] Input Validation: Validated all parameters have appropriate bounds checks
  - [ ] Unchecked Returns: All external calls have return value checks (`require(success, ...)`)
  - [ ] Gas Limits: No unbounded loops or potential DOS vectors
  
  **If any checkbox cannot be verified, explain below:**
  ```
  ```

### Slither Static Analysis Results
- [ ] Ran Slither locally: `slither . --config-file slither.config.json`
  - **Result**: ✅ No High/Medium findings OR 🟡 Documented false positives (see below)
  
- [ ] GitHub Actions Slither workflow passed:
  - 🟢 All High/Medium findings fixed OR
  - 🟡 All false positives documented with FP references
  
  **If this PR has security findings, document them below:**
  ```
  ```

### Handling Security Findings

#### Option A: Fixed in This PR ✅
- [ ] Vulnerability identified and resolved
- [ ] Test case added to verify fix
- [ ] Explain fix below:
  ```
  ```

#### Option B: False Positive 🟡
- [ ] Identified as false positive (tool limitation or misleading check)
- [ ] Added entry to `contracts/.false-positives.md` with:
  - Detector rule name
  - Technical reasoning (3+ sentences why it's safe)
  - Evidence (code snippet, test case, or reference)
- [ ] Reference number (e.g., FP-001):
  ```
  ```
- [ ] Inline suppression added to code:
  ```solidity
  // slither-disable-next-line <detector-name>
  // Reason: [one-line reason]
  ```

#### Option C: Accepted Risk ⚠️
- [ ] Acknowledged as low-priority style issue (naming conventions, etc.)
- [ ] Added to Slither exclusions
- [ ] Explain below:
  ```
  ```

---

## 📝 Testing

### Functional Testing
- [ ] Unit tests added/updated for changes
- [ ] Integration tests passing
- [ ] End-to-end (E2E) tests passing
- [ ] Manual testing completed and documented below:
  ```
  ```

### Security Testing
- For state-changing functions:
  - [ ] Reentrancy test (if applicable): Verify re-entry is blocked
  - [ ] Access control test: Verify unauthorized access is rejected
  - [ ] Boundary / Edge-case test: Verify limits, zero-amounts, and rounding behavior
  
- For external integrations:
  - [ ] Return value verification test
  - [ ] Failure / timeout scenario test

### Test Coverage
- [ ] All new code paths have test coverage
- [ ] Security-critical paths have comprehensive test cases
- [ ] Coverage report:
  ```
  ```

---

## 🚀 Deployment Notes

### Mainnet Readiness
- [ ] This code is ready for production deployment
- [ ] All critical tests pass
- [ ] Security review approved
- [ ] No temporary debug code
- [ ] No TODO comments

### Breaking Changes
If this PR introduces breaking changes:
- [ ] Migration guide provided
- [ ] Deprecation period defined: `[timeframe]`
- [ ] Legacy code deprecated with warnings

---

## 📊 Automated Scan Results

<!-- GitHub Actions will update this section -->

### Slither Analysis
- ✓ Status:
- 🔴 High/Medium findings: 0
- 🟡 Low/Informational findings: 0

### Related Documentation
- [Security Checklist](docs/SECURITY_CHECKLIST.md) — Use for code review
- [False Positive Process](docs/FALSE_POSITIVE_HANDLING.md) — For non-vulnerabilities
- [Slither Configuration](slither.config.json) — Current scanner settings

---

## ✅ Reviewer Checklist

**For code reviewers** (use this to guide your review):

- [ ] PR author completed Risk Assessment and Rollback Plan ✓
- [ ] Performance and gas impact evaluated and verified ✓
- [ ] PR author completed security checklist ✓
- [ ] All findings documented and categorized (fixed/false positive/excluded)
- [ ] Inline security comments are clear and justified
- [ ] Tests cover security-critical code paths
- [ ] No external calls bypass return value checks
- [ ] Access control is properly enforced
- [ ] State updates follow CEI pattern
- [ ] Input validation is comprehensive
- [ ] Follow-up actions (if any) tracked in issues

---

## 📞 Questions or Issues?

- 🤔 Confused about security checklist? → See [`docs/SECURITY_CHECKLIST.md`](/docs/SECURITY_CHECKLIST.md)
- 🔍 Marking finding as false positive? → Follow [`docs/FALSE_POSITIVE_HANDLING.md`](/docs/FALSE_POSITIVE_HANDLING.md)
- 🆘 Need security review help? → Tag `@security-team` in comments

---

## 📋 Pre-Submit Checklist

Before marking PR as ready for review:

- [ ] Description, Goal, and Changes are clearly stated
- [ ] Risk Assessment completed with appropriate risk tier and blast radius
- [ ] Rollback Plan completed with concrete steps and trigger criteria
- [ ] Performance Impact assessed with gas / compute benchmarks
- [ ] All security checklist items checked (✅ or explanation provided)
- [ ] All tests passing locally: `npm test`
- [ ] Linter passing: `npm run lint`
- [ ] Slither passing locally OR findings documented: `slither . --config-file slither.config.json`
- [ ] Code follows project style guide
- [ ] No merge conflicts
- [ ] Commits are clean and well-documented
- [ ] Branch is up-to-date with main/develop
- [ ] For **release PRs**: `docs/RELEASE_READINESS_CHECKLIST.md` completed and linked in PR description

---

**✅ Ready for Review?** Ensure all items above are checked before requesting review.
