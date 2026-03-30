# Security Scanning - Quick Reference Card

Print this and keep it at your desk! 🖨️

---

## 🚀 Before You Commit

```bash
# 1. Run security scans locally
cargo audit
cargo clippy --all-targets
slither . --config-file slither.config.json  # If Solidity code present

# 2. Fix issues or document as false positive
# 3. Use SECURITY_CHECKLIST.md for manual review
# 4. Push to GitHub - Workflows run automatically
```

---

## 🔍 What Gets Scanned?

| Tool | Checks | Fails Build On |
|------|--------|---|
| **Slither** | Solidity vulnerabilities | High/Medium severity |
| **Cargo Audit** | Vulnerable dependencies | Any advisory |
| **Clippy** | Code quality & safety | Warnings (non-blocking) |
| **Manual** | Business logic security | Code review approval |

---

## 📋 Security Checklist (Quick)

When reviewing code, check:

- [ ] **Reentrancy**: External calls after state updates?
- [ ] **Access Control**: Admin functions protected?
- [ ] **Overflow**: Math operations safe?
- [ ] **Returns**: External calls validated?
- [ ] **Delegation**: No unsafe delegatecall?

👉 See: [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md)

---

## ❌ If Your Code Gets Flagged

### Option 1: Fix It (Preferred)
```bash
# Make the security improvement
# Test it
# Push updated code
```

### Option 2: Document as False Positive
1. Open: [`docs/FALSE_POSITIVE_HANDLING.md`](docs/FALSE_POSITIVE_HANDLING.md)
2. Follow steps 1-4 for your finding
3. Add entry to: [`contracts/.false-positives.md`](contracts/.false-positives.md)
4. Get security team approval in PR
5. Reference in code: `// SAFETY: [reason]`

---

## 🛠️ Suppress a Finding

### Solidity
```solidity
// slither-disable-next-line reentrancy-eth
function myFunction() {
    // This line won't be flagged
}
```

### Rust
```rust
#[allow(clippy::too_many_arguments)]
fn my_function(...) {
    // Clippy warning suppressed
}
```

---

## 📁 Where to Find Things

| Need | File |
|------|------|
| Setup help | `docs/SECURITY_SCANNING_GUIDE.md` |
| Manual review checklist | `docs/SECURITY_CHECKLIST.md` |
| False positive process | `docs/FALSE_POSITIVE_HANDLING.md` |
| Implementation details | `docs/IMPLEMENTATION_SUMMARY.md` |
| Your security config | `slither.config.json` |
| FP registry | `contracts/.false-positives.md` |
| Test examples | `contracts/vault/tests/security_tests.rs` |

---

## 🆘 Quick Fixes

| Problem | Solution |
|---------|----------|
| Slither won't install | `pip install slither-analyzer` |
| Cargo audit failing | `cargo update` affected crate |
| Clippy too strict | Add `#[allow(...)]` if justified |
| Workflow failed | Check GitHub Actions tab → Details |
| Don't understand finding | Check `SECURITY_CHECKLIST.md` section |

---

## ✅ Workflow Status Meanings

| Status | Meaning |
|--------|---------|
| 🟢 **Pass** | No High/Medium findings |
| 🔴 **Fail** | High/Medium security issues found |
| 🟡 **With Comment** | Low findings logged but build passes |

---

## 👥 Who to Ask

- **"Is this safe?"** → Check checklist, then ask @security-team
- **"Workflow error?"** → Check Actions tab, then ask @devops-team
- **"How to suppress?"** → See FALSE_POSITIVE_HANDLING.md
- **"General question?"** → Check docs/SECURITY_SCANNING_GUIDE.md

---

## 🎯 Key Principles

1. **Security first**: Fix real issues, don't hide them
2. **No dark magic**: Suppressions need justification
3. **Test everything**: Especially security patterns
4. **Document decisions**: Future-proof via .false-positives.md
5. **Keep it updated**: Quarterly security reviews

---

## 📊 Performance Impact

- **Slither**: +5-10 min per PR
- **Cargo Audit**: +2-4 min per PR
- **Total**: ~10-15 min added to CI/CD (runs in parallel)

**Worth it?** Yes! Catches 80% of common vulnerabilities

---

## 🔐 Remember

> *Security is everyone's responsibility, not just security team's*

---

**Last Updated**: 2024-01-15  
**Keep This Handy** ⭐
