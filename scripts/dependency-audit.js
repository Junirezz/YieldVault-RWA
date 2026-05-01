#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/dependency-audit.js <npm|cargo> <name> <report-path>');
  process.exit(2);
}

const [type, name, reportPath] = args;
const absolutePath = path.resolve(process.cwd(), reportPath);
let report;
try {
  report = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
} catch (error) {
  console.error(`Unable to read or parse audit report: ${error}`);
  process.exit(2);
}

const unfixableIssues = [];

function addIssue(source, id, title, severity, details) {
  unfixableIssues.push({ source, id, title, severity, details });
}

if (type === 'npm') {
  const advisories = report.advisories ? Object.values(report.advisories) : [];
  for (const advisory of advisories) {
    const severity = advisory.severity?.toLowerCase();
    if (severity !== 'high' && severity !== 'critical') {
      continue;
    }
    const fixAvailable = advisory.fixAvailable && advisory.fixAvailable.version;
    if (!fixAvailable) {
      addIssue('npm', advisory.id, advisory.title, severity, advisory.url || 'No URL available');
    }
  }
} else if (type === 'cargo') {
  const list = report.vulnerabilities?.list || [];
  for (const item of list) {
    const advisory = item.advisory || {};
    const severity = (advisory.severity || '').toLowerCase();
    if (severity !== 'high' && severity !== 'critical') {
      continue;
    }
    const versions = item.versions || {};
    const patched = Array.isArray(versions.patched) ? versions.patched.length > 0 : false;
    const patchedFromAdvisory = Array.isArray(advisory.patched_versions)
      ? advisory.patched_versions.length > 0
      : false;
    const hasFix = patched || patchedFromAdvisory;
    if (!hasFix) {
      addIssue('cargo', advisory.id || item.id || 'unknown', advisory.title || advisory.package || 'Unknown advisory', severity, advisory.url || 'No URL available');
    }
  }
} else {
  console.error(`Unsupported audit type: ${type}`);
  process.exit(2);
}

if (unfixableIssues.length > 0) {
  console.error(`\n❌ ${name}: High/critical dependency vulnerabilities without an available fix were found.`);
  for (const issue of unfixableIssues) {
    console.error(`- [${issue.severity.toUpperCase()}] ${issue.source} advisory ${issue.id}: ${issue.title}`);
    console.error(`  ${issue.details}`);
  }
  process.exit(1);
}

console.log(`✅ ${name}: No unfixable high/critical dependency vulnerabilities found.`);
process.exit(0);
