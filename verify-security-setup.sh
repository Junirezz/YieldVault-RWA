#!/bin/bash

# Security Scanning Setup Verification Script
# 
# Usage: ./verify-security-setup.sh
# 
# This script verifies that all security scanning components are properly
# configured and ready for use in the development workflow.

set -e

echo "🔍 YieldVault-RWA Security Scanning Setup Verification"
echo "======================================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter for checks
PASS=0
FAIL=0
WARN=0

# Helper functions
pass_check() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASS++))
}

fail_check() {
    echo -e "${RED}✗${NC} $1"
    ((FAIL++))
}

warn_check() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARN++))
}

echo "📋 Checking File Structure..."
echo "----------------------------"

# Check essential files exist
[[ -f ".github/workflows/slither.yml" ]] && pass_check "Slither workflow found" || fail_check "Slither workflow missing"
[[ -f ".github/workflows/rust-security.yml" ]] && pass_check "Rust security workflow found" || fail_check "Rust security workflow missing"
[[ -f "slither.config.json" ]] && pass_check "Slither configuration found" || fail_check "Slither configuration missing"
[[ -f ".github/PULL_REQUEST_TEMPLATE.md" ]] && pass_check "PR template found" || fail_check "PR template missing"
[[ -f "docs/SECURITY_CHECKLIST.md" ]] && pass_check "Security checklist found" || fail_check "Security checklist missing"
[[ -f "docs/FALSE_POSITIVE_HANDLING.md" ]] && pass_check "False positive guide found" || fail_check "False positive guide missing"
[[ -f "docs/SECURITY_SCANNING_GUIDE.md" ]] && pass_check "Security scanning guide found" || fail_check "Security scanning guide missing"
[[ -f "contracts/.false-positives.md" ]] && pass_check "False positives registry found" || fail_check "False positives registry missing"

echo ""
echo "🛠️  Checking Local Tool Installation..."
echo "--------------------------------------"

# Check Slither
if command -v slither &> /dev/null; then
    SLITHER_VERSION=$(slither --version 2>&1 | head -1 || echo "unknown")
    pass_check "Slither installed: $SLITHER_VERSION"
else
    warn_check "Slither not installed (optional for local dev). Install: pip install slither-analyzer"
fi

# Check cargo-audit
if cargo audit --version &> /dev/null 2>&1; then
    pass_check "cargo-audit installed"
else
    warn_check "cargo-audit not installed (optional). Install: cargo install cargo-audit"
fi

# Check clippy
if cargo clippy --version &> /dev/null 2>&1; then
    pass_check "Clippy installed"
else
    fail_check "Clippy not installed. Install: rustup component add clippy"
fi

echo ""
echo "⚙️  Checking Configuration..."
echo "----------------------------"

# Check slither.config.json validity
if jq . slither.config.json > /dev/null 2>&1; then
    pass_check "slither.config.json is valid JSON"
else
    fail_check "slither.config.json is invalid JSON"
fi

# Check PR template references security
if grep -q "SECURITY_CHECKLIST" ".github/PULL_REQUEST_TEMPLATE.md"; then
    pass_check "PR template references security checklist"
else
    fail_check "PR template doesn't reference security checklist"
fi

# Check workflow YAML validity
if command -v yamllint &> /dev/null; then
    yamllint ".github/workflows/slither.yml" > /dev/null 2>&1 && \
        pass_check "Slither workflow YAML valid" || \
        fail_check "Slither workflow YAML invalid"
    yamllint ".github/workflows/rust-security.yml" > /dev/null 2>&1 && \
        pass_check "Rust security workflow YAML valid" || \
        fail_check "Rust security workflow YAML invalid"
else
    warn_check "yamllint not installed (optional). Skipping YAML validation."
fi

echo ""
echo "📂 Checking Documentation..."
echo "----------------------------"

# Check documentation exists and isn't empty
DOCS=(
    "docs/SECURITY_CHECKLIST.md"
    "docs/FALSE_POSITIVE_HANDLING.md"
    "docs/SECURITY_SCANNING_GUIDE.md"
    "docs/IMPLEMENTATION_SUMMARY.md"
    "contracts/.false-positives.md"
)

for doc in "${DOCS[@]}"; do
    if [[ -f "$doc" ]]; then
        SIZE=$(wc -l < "$doc")
        if [[ $SIZE -gt 10 ]]; then
            pass_check "$doc exists ($SIZE lines)"
        else
            fail_check "$doc exists but appears incomplete (<10 lines)"
        fi
    fi
done

echo ""
echo "🔐 Checking Security Settings..."
echo "-------------------------------"

# Check slither config has exclude settings
if grep -q '"exclude"' slither.config.json; then
    EXCLUDES=$(grep -A 5 '"exclude"' slither.config.json | grep -c ',' || echo "0")
    pass_check "Slither exclusions configured (detectors/paths)"
else
    warn_check "Consider adding exclusions to slither.config.json"
fi

# Check that dangerous patterns are detected
if grep -q "reentrancy\|unchecked-transfer\|arbitrary-send" slither.config.json; then
    pass_check "Critical detectors enabled (reentrancy, unchecked-transfer, arbitrary-send)"
else
    fail_check "Critical detectors may be disabled in slither.config.json"
fi

# Check fail-on setting
if grep -q '"fail_on".*"high"' slither.config.json || grep -q '"fail_on".*"medium"' slither.config.json; then
    pass_check "Fail-on threshold properly set"
else
    warn_check "Verify fail-on threshold is appropriate"
fi

echo ""
echo "🧪 Checking Test Coverage..."
echo "---------------------------"

# Check security test file exists
if [[ -f "contracts/vault/tests/security_tests.rs" ]]; then
    TESTS=$(grep -c "#\[test\]" "contracts/vault/tests/security_tests.rs" || echo "0")
    pass_check "Security test file exists with $TESTS test cases"
else
    fail_check "Security test file not found: contracts/vault/tests/security_tests.rs"
fi

echo ""
echo "📊 Checking GitHub Integration..."
echo "--------------------------------"

# Check if .git exists (GitHub repo)
if [[ -d ".git" ]]; then
    pass_check "Git repository initialized"
    
    # Check if workflows would trigger
    if git rev-parse --verify HEAD > /dev/null 2>&1; then
        pass_check "Git HEAD exists (workflows will trigger on PR)"
    else
        warn_check "No commits yet (workflows will trigger on first PR)"
    fi
    
    # Check branch structure
    if git show-ref --quiet refs/heads/main || git show-ref --quiet refs/heads/develop; then
        pass_check "main or develop branch exists"
    else
        warn_check "Neither main nor develop branch found yet"
    fi
else
    warn_check "Not a git repository (workflows won't function until pushed to GitHub)"
fi

echo ""
echo "📝 Checking Documentation References..."
echo "--------------------------------------"

# Check cross-references between docs
if grep -q "FALSE_POSITIVE_HANDLING.md" "docs/SECURITY_CHECKLIST.md"; then
    pass_check "SECURITY_CHECKLIST references FALSE_POSITIVE_HANDLING"
fi

if grep -q "SECURITY_CHECKLIST.md" "docs/FALSE_POSITIVE_HANDLING.md"; then
    pass_check "FALSE_POSITIVE_HANDLING references SECURITY_CHECKLIST"
fi

if grep -q ".false-positives.md" "docs/FALSE_POSITIVE_HANDLING.md"; then
    pass_check "Documentation references contracts/.false-positives.md"
fi

echo ""
echo "═══════════════════════════════════════"
echo "📊 Summary"
echo "═══════════════════════════════════════"
echo ""
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${YELLOW}Warnings: $WARN${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}✅ Setup Complete!${NC}"
    echo ""
    echo "🚀 Next Steps:"
    echo "1. Review docs/SECURITY_SCANNING_GUIDE.md"
    echo "2. Run tests locally: cargo test --test security_tests"
    echo "3. Push changes to test workflows on GitHub"
    echo "4. Review Security tab for scan results"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Setup Incomplete${NC}"
    echo ""
    echo "🔧 Actions Required:"
    echo "1. Review failed checks above"
    echo "2. Consult docs/IMPLEMENTATION_SUMMARY.md for guidance"
    echo "3. Fix any missing or invalid files"
    echo ""
    exit 1
fi
