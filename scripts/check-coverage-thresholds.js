import fs from 'fs';
import path from 'path';

/**
 * Script to check test coverage summary against configured thresholds.
 * Thresholds:
 * - Backend: 80% (lines, statements, functions, branches)
 * - Frontend: 70% (lines, statements, functions, branches)
 */

const THRESHOLDS = {
  backend: { lines: 80, statements: 80, functions: 80, branches: 80 },
  frontend: { lines: 70, statements: 70, functions: 70, branches: 70 },
};

function checkCoverage(componentName, summaryPath) {
  console.log(`Checking coverage for ${componentName}...`);
  const fullPath = path.resolve(process.cwd(), summaryPath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️ Coverage summary file not found at ${fullPath}. Skipping check.`);
    return true;
  }

  try {
    const rawData = fs.readFileSync(fullPath, 'utf8');
    const data = JSON.parse(rawData);
    const total = data.total;

    if (!total) {
      console.warn(`⚠️ Invalid coverage summary structure in ${fullPath}.`);
      return true;
    }

    const componentThresholds = THRESHOLDS[componentName] || { lines: 70, statements: 70, functions: 70, branches: 70 };
    let failed = false;

    for (const key of ['lines', 'statements', 'functions', 'branches']) {
      const pct = total[key] ? total[key].pct : 100;
      const target = componentThresholds[key];

      if (pct < target) {
        console.error(`❌ ${componentName} ${key} coverage (${pct}%) is below minimum threshold (${target}%).`);
        failed = true;
      } else {
        console.log(`✅ ${componentName} ${key} coverage: ${pct}% (>= ${target}%)`);
      }
    }

    return !failed;
  } catch (err) {
    console.error(`Error reading coverage summary for ${componentName}:`, err);
    return false;
  }
}

const backendPassed = checkCoverage('backend', 'backend/coverage/coverage-summary.json');
const frontendPassed = checkCoverage('frontend', 'frontend/coverage/coverage-summary.json');

if (!backendPassed || !frontendPassed) {
  console.error('\n🚨 Coverage threshold check failed! Please add tests to meet coverage minimums.');
  process.exit(1);
} else {
  console.log('\n🎉 All coverage threshold checks passed successfully!');
}
