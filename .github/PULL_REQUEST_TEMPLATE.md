# Pull Request Template

## 📋 Description
<!-- Provide a brief description of the changes in this PR -->

## 🔗 Type of Change
- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] ⚠️ Breaking change (fix or feature that would cause existing functionality to change)
- [ ] 📚 Documentation update
- [ ] 🔒 Security improvement

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
  [Explanation here]
  ```

### Slither Static Analysis Results
- [ ] Ran Slither locally: `slither . --config-file slither.config.json`
  - **Result**: ✅ No High/Medium findings OR 🟡 Documented false positives (see below)
  
- [ ] GitHub Actions Slither workflow passed:
  - 🟢 All High/Medium findings fixed OR
  - 🟡 All false positives documented with FP references
  
  **If this PR has security findings, document them below:**

### Handling Security Findings

#### Option A: Fixed in This PR ✅
- [ ] Vulnerability identified and resolved
- [ ] Test case added to verify fix
- [ ] Explain fix below:
  ```
  [Explanation of fix]
  ```

#### Option B: False Positive 🟡
- [ ] Identified as false positive (tool limitation or misleading check)
- [ ] Added entry to `contracts/.false-positives.md` with:
  - Detector rule name
  - Technical reasoning (3+ sentences why it's safe)
  - Evidence (code snippet, test case, or reference)
- [ ] Reference number (e.g., FP-001):
  ```
  [FP number and explanation]
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
  [Explanation]
  ```

---

## 📝 Testing

### Functional Testing
- [ ] Unit tests added/updated for changes
- [ ] Integration tests passing
- [ ] Manual testing completed and documented below:
  ```
  [Testing steps or scenarios]
  ```

### Security Testing
- For state-changing functions:
  - [ ] Reentrancy test (if applicable): Verify re-entry is blocked
  - [ ] Access control test: Verify unauthorized access is rejected
  - [ ] Boundary test: Verify edge cases are handled
  
- For external integrations:
  - [ ] Return value verification test
  - [ ] Failure scenario test

### Test Coverage
- [ ] All new code paths have test coverage
- [ ] Security-critical paths have comprehensive test cases
- [ ] Coverage report: `[Link or reference]`

---

## 🚀 Deployment Notes

<!-- Any deployment considerations, migration steps, or special instructions -->

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
- ✓ Status: [Pending workflow execution]
- 🔴 High/Medium findings: [Number] ([View in Security tab](../../security/code-scanning))
- 🟡 Low/Informational findings: [Number]
- 🟢 No issues detected: [If applicable]

### Related Documentation
- [Security Checklist](docs/SECURITY_CHECKLIST.md) — Use for code review
- [False Positive Process](docs/FALSE_POSITIVE_HANDLING.md) — For non-vulnerabilities
- [Slither Configuration](slither.config.json) — Current scanner settings

---

## ✅ Reviewer Checklist

**For code reviewers** (use this to guide your security-focused review):

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

- [ ] Description is clear and concise
- [ ] All security checklist items checked (✅ or explanation provided)
- [ ] All tests passing locally: `npm test`
- [ ] Linter passing: `npm run lint`
- [ ] Slither passing locally OR findings documented: `slither . --config-file slither.config.json`
- [ ] Code follows project style guide
- [ ] No merge conflicts
- [ ] Commits are clean and well-documented
- [ ] Branch is up-to-date with main/develop

---

**✅ Ready for Review?** Ensure all items above are checked before requesting review.

