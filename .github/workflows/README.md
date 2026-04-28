# GitHub Workflows - Security Scanning

This directory contains automated security scanning workflows for the YieldVault-RWA project.

## 📁 Files

### Security Workflows (New)

| Workflow | Trigger | Purpose | Duration |
|----------|---------|---------|----------|
| **`slither.yml`** | PR to main/develop | Ethereum/Solidity static analysis | 5-10 min |
| **`rust-security.yml`** | PR to main/develop | Rust dependency audit + linting | 2-4 min |
| **`frontend.yml`** | PR to main | npm dependency audit + build/tests | 5-8 min |
| **`backend-governance.yml`** | PR to main | backend governance + npm auditing | 4-6 min |

### Existing Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `e2e.yml` | PR, push to main | Playwright E2E tests |
| `docs.yml` | PR, push to main | API documentation generation |

---

## 🚀 Quick Start

### For Developers
1. **Install local tools**:
   ```bash
   pip install slither-analyzer
   cargo install cargo-audit
   ```

2. **Run before committing**:
   ```bash
   slither . --config-file slither.config.json
   cargo audit
   cargo clippy --all-targets
   ```

3. **Create PR** → Workflows run automatically

### For DevOps
1. **Verify workflows**: Check Actions tab
2. **Adjust config**: Edit `slither.config.json` if needed
3. **Monitor**: Review SARIF uploads to Security tab

---

## 📊 Workflow Details

### Slither (slither.yml)
```yaml
Triggers: Pull Request to main or develop
Checks:   Solidity vulnerabilities
Fails On: High or Medium severity
Output:   SARIF + PR comment
Config:   slither.config.json
```

**Security Checks**:
- Reentrancy attacks
- Unchecked external calls
- Integer overflow/underflow
- Access control violations
- Delegatecall abuse

**Excluded** (Low Priority):
- Naming conventions
- Assembly usage
- Tool version warnings

### Rust Security (rust-security.yml)
```yaml
Triggers: Pull Request to main or develop
Checks:   Dependencies + Code quality + Unsafe code
Tools:    cargo-audit, cargo-clippy, cargo-deny
Fails On: Cargo audit warnings
Output:   PR comment + artifact
```

**Security Checks**:
- Vulnerable dependencies
- Code quality issues
- Clippy lint warnings
- Unsafe code blocks
- Supply chain verification

---

## 🔧 Configuration

### Slither Configuration (`slither.config.json`)

**Current Settings**:
- **Fail On**: High severity (only breaks build on High/Medium)
- **Excluded Detectors**: naming-convention, solc-version, low-level-calls
- **Filter Paths**: node_modules, lib, test, mock
- **Output Format**: JSON (for SARIF conversion)

**To Adjust**:
```json
{
  "exclude": ["detector-name"],     // Add to skip checks
  "filter_paths": ["ignore/path"],  // Paths to ignore
  "fail_on": "high"                 // Raise to "medium" for stricter
}
```

### Rust Configuration (Cargo.toml)

Use `[build]` section for Clippy options (if needed):
```toml
[profile.dev]
opt-level = 0

[profile.release]
opt-level = 3
```

---

## 📈 Monitoring & Maintenance

### Weekly
- [ ] Review PR security comments
- [ ] Address High findings immediately

### Monthly
- [ ] Update dependencies: `cargo update`
- [ ] Rerun: `cargo audit`

### Quarterly
- [ ] Review workflow configuration
- [ ] Check GitHub Security tab for historical findings
- [ ] Update exclusions if necessary

---

## 🆘 Troubleshooting

### "Workflow failed: Slither compilation error"
1. Check that code compiles locally: `npm run build`
2. Workflow has fallback: continues even if build fails
3. Review PR comments for actual issues

### "Cargo audit keeps finding vulnerability"
1. Run locally: `cargo audit`
2. Update: `cargo update vulnerable_crate`
3. If unfixable: Document in [docs/FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)

### "My code was flagged as false positive"
1. Don't suppress yet! Document first
2. See: [docs/FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)
3. Tag @security-team in PR for approval

---

## 📚 Documentation

- **Setup Guide**: [docs/SECURITY_SCANNING_GUIDE.md](../docs/SECURITY_SCANNING_GUIDE.md)
- **Manual Checklist**: [docs/SECURITY_CHECKLIST.md](../docs/SECURITY_CHECKLIST.md)
- **False Positive Handling**: [docs/FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)
- **Implementation Details**: [docs/IMPLEMENTATION_SUMMARY.md](../docs/IMPLEMENTATION_SUMMARY.md)

---

## 🔐 Security Best Practices

✅ **Do**:
- Review all security warnings
- Fix real issues first
- Document false positives
- Run tools locally before pushing
- Use the security checklist

❌ **Don't**:
- Suppress warnings without understanding
- Skip security reviews
- Merge with High-severity findings
- Disable entire workflow checks
- Ignore Cargo audit vulnerabilities

---

## 📞 Support

- **Questions?** → Check documentation above
- **Issue with workflow?** → Contact @devops-team
- **Security concern?** → Contact @security-team
- **False positive?** → Follow [FALSE_POSITIVE_HANDLING.md](../docs/FALSE_POSITIVE_HANDLING.md)

---

**Last Updated**: 2024-01-15  
**Maintained By**: DevSecOps Team
