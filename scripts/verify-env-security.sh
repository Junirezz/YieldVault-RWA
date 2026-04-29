#!/bin/bash
# Environment Variable Security Verification Script
# This script checks for common security issues with environment variable management

set -e

echo "🔒 YieldVault Environment Security Verification"
echo "================================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Function to print success
success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print error
error() {
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
}

# Function to print warning
warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

echo "1. Checking .gitignore configuration..."
echo "----------------------------------------"

# Check if .env files are in .gitignore
if grep -q "^\.env$" .gitignore; then
    success ".env files are gitignored"
else
    error ".env files not found in .gitignore"
fi

if grep -q "^\.env\.local$" .gitignore; then
    success ".env.local files are gitignored"
else
    error ".env.local files not found in .gitignore"
fi

if grep -q "^\.env\.production$" .gitignore; then
    success ".env.production files are gitignored"
else
    error ".env.production files not found in .gitignore"
fi

echo ""
echo "2. Checking for committed secrets..."
echo "----------------------------------------"

# Check if any .env files (except .example) are tracked by git
if git ls-files | grep -E "\.env$|\.env\.local$|\.env\.production$" > /dev/null 2>&1; then
    error "Found .env files tracked by git!"
    git ls-files | grep -E "\.env$|\.env\.local$|\.env\.production$"
else
    success "No .env files tracked by git"
fi

# Check for hardcoded contract IDs in source files
echo ""
echo "3. Checking for hardcoded secrets in source code..."
echo "----------------------------------------"

# Check for potential hardcoded Stellar addresses (excluding test files)
HARDCODED_ADDRESSES=$(grep -r "G[A-Z0-9]\{55\}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=build \
    --exclude="*.test.*" \
    --exclude="*.spec.*" \
    --exclude="*fixtures*" \
    frontend/src backend/src 2>/dev/null | grep -v "MOCK\|TEST\|EXAMPLE" || true)

if [ -z "$HARDCODED_ADDRESSES" ]; then
    success "No hardcoded Stellar addresses found in source code"
else
    warning "Found potential hardcoded addresses (verify these are test/mock values):"
    echo "$HARDCODED_ADDRESSES" | head -5
fi

# Check for hardcoded API keys or secrets
POTENTIAL_SECRETS=$(grep -r -i "api_key\s*=\s*['\"][^'\"]\+['\"]" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude="*.test.*" \
    --exclude="*.spec.*" \
    frontend/src backend/src 2>/dev/null || true)

if [ -z "$POTENTIAL_SECRETS" ]; then
    success "No hardcoded API keys found in source code"
else
    error "Found potential hardcoded API keys:"
    echo "$POTENTIAL_SECRETS"
fi

echo ""
echo "4. Checking environment file structure..."
echo "----------------------------------------"

# Check backend
if [ -f "backend/.env.example" ]; then
    success "backend/.env.example exists"
else
    error "backend/.env.example missing"
fi

if [ -f "backend/.env.local.example" ]; then
    success "backend/.env.local.example exists"
else
    warning "backend/.env.local.example missing (recommended)"
fi

if [ -f "backend/.env.production.example" ]; then
    success "backend/.env.production.example exists"
else
    warning "backend/.env.production.example missing (recommended)"
fi

# Check frontend
if [ -f "frontend/.env.example" ]; then
    success "frontend/.env.example exists"
else
    error "frontend/.env.example missing"
fi

if [ -f "frontend/.env.local.example" ]; then
    success "frontend/.env.local.example exists"
else
    warning "frontend/.env.local.example missing (recommended)"
fi

if [ -f "frontend/.env.production.example" ]; then
    success "frontend/.env.production.example exists"
else
    warning "frontend/.env.production.example missing (recommended)"
fi

echo ""
echo "5. Checking for secrets in git history..."
echo "----------------------------------------"

# Check git history for potential secrets (last 100 commits)
if git log -100 -p | grep -i "api_key\s*=\s*['\"][a-zA-Z0-9]\{20,\}" > /dev/null 2>&1; then
    error "Potential API keys found in git history!"
    warning "Consider using git-filter-repo or BFG Repo-Cleaner to remove secrets"
else
    success "No obvious secrets found in recent git history"
fi

echo ""
echo "6. Checking deployment files..."
echo "----------------------------------------"

# Check if deployment files have empty contract IDs
if [ -f "deployments/contracts.testnet.json" ]; then
    if grep -q '"vault":\s*""' deployments/contracts.testnet.json; then
        success "deployments/contracts.testnet.json has empty contract ID (safe)"
    else
        warning "deployments/contracts.testnet.json contains contract ID"
    fi
fi

if [ -f "deployments/contracts.mainnet.json" ]; then
    if grep -q '"vault":\s*""' deployments/contracts.mainnet.json; then
        success "deployments/contracts.mainnet.json has empty contract ID (safe)"
    else
        warning "deployments/contracts.mainnet.json contains contract ID"
    fi
fi

echo ""
echo "7. Checking for environment variable usage..."
echo "----------------------------------------"

# Check if code properly uses environment variables
if grep -r "process\.env\." backend/src --include="*.ts" > /dev/null 2>&1; then
    success "Backend uses process.env for configuration"
else
    warning "Backend may not be using environment variables"
fi

if grep -r "import\.meta\.env\." frontend/src --include="*.ts" --include="*.tsx" > /dev/null 2>&1; then
    success "Frontend uses import.meta.env for configuration"
else
    warning "Frontend may not be using environment variables"
fi

echo ""
echo "================================================"
echo "Summary:"
echo "--------"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo "Review warnings above and address if necessary"
    exit 0
else
    echo -e "${RED}✗ $ERRORS error(s) and $WARNINGS warning(s) found${NC}"
    echo "Please fix the errors above before deploying"
    exit 1
fi
