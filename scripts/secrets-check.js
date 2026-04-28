#!/usr/bin/env node
/**
 * Secret Scanner Pre-commit Hook
 * Detects common secret patterns in staged files
 * 
 * Run: node scripts/secrets-check.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Common secret patterns
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Key', pattern: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/ },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'API Key', pattern: /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?/i },
  { name: 'Secret Token', pattern: /secret[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?/i },
  { name: 'Password', pattern: /password["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i },
  { name: 'Bearer Token', pattern: /Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24}/ },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/ },
  { name: 'Database URL', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/i },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'Generic Secret', pattern: /["']?(?:secret|token|key|api_key|apikey)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i },
];

// Files to skip
const SKIP_PATHS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.secrets.baseline',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return output.split('\n').filter(f => f.trim());
  } catch (error) {
    console.error('Error getting staged files:', error.message);
    return [];
  }
}

function scanFile(filePath) {
  const findings = [];
  
  // Skip binary files and certain extensions
  const ext = path.extname(filePath).toLowerCase();
  const skipExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz'];
  if (skipExtensions.includes(ext)) {
    return findings;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      SECRET_PATTERNS.forEach(({ name, pattern }) => {
        if (pattern.test(line)) {
          findings.push({
            file: filePath,
            line: index + 1,
            type: name,
            snippet: line.trim().substring(0, 80)
          });
        }
      });
    });
  } catch (error) {
    // Skip files that can't be read
  }
  
  return findings;
}

function main() {
  console.log('🔍 Scanning for secrets in staged files...\n');
  
  const stagedFiles = getStagedFiles();
  
  if (stagedFiles.length === 0) {
    console.log('✅ No staged files to scan');
    process.exit(0);
  }
  
  let allFindings = [];
  
  stagedFiles.forEach(file => {
    // Skip certain paths
    if (SKIP_PATHS.some(skip => file.includes(skip))) {
      return;
    }
    
    const findings = scanFile(file);
    allFindings = allFindings.concat(findings);
  });
  
  if (allFindings.length > 0) {
    console.log('❌ Secrets detected in staged files:\n');
    allFindings.forEach(finding => {
      console.log(`  ${finding.type} found in ${finding.file}:${finding.line}`);
      console.log(`    ${finding.snippet}`);
      console.log('');
    });
    
    console.log('Commit blocked due to potential secrets.');
    console.log('If this is a false positive, you can bypass with: git commit --no-verify');
    process.exit(1);
  }
  
  console.log('✅ No secrets detected');
  process.exit(0);
}

main();