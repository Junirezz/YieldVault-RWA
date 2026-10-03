import { spawnSync } from 'child_process';

interface FlakyRunResult {
  iteration: number;
  success: boolean;
  durationMs: number;
  output: string;
}

export function runFlakyDetection(
  iterations = 10,
  testPattern = 'src/__tests__/flakyRetry.test.ts',
): {
  iterations: number;
  passed: number;
  failed: number;
  results: FlakyRunResult[];
} {
  console.log(`🔍 Starting Flaky Test Detector (${iterations} iterations) targeting: "${testPattern}"`);

  const results: FlakyRunResult[] = [];
  let passed = 0;
  let failed = 0;

  for (let i = 1; i <= iterations; i++) {
    const start = Date.now();
    console.log(`▶ Run ${i}/${iterations}...`);

    const child = spawnSync('npm', ['test', '--', testPattern], {
      shell: true,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test', CI: 'true' },
    });

    const durationMs = Date.now() - start;
    const success = child.status === 0;

    if (success) {
      passed++;
      console.log(`  ✓ Run ${i} passed (${(durationMs / 1000).toFixed(1)}s)`);
    } else {
      failed++;
      console.log(`  ❌ Run ${i} failed (${(durationMs / 1000).toFixed(1)}s)`);
    }

    results.push({
      iteration: i,
      success,
      durationMs,
      output: child.stdout || child.stderr || '',
    });
  }

  console.log('==============================================');
  console.log(`Summary: ${passed} passed, ${failed} failed out of ${iterations} runs`);
  console.log('==============================================');

  return { iterations, passed, failed, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const iterations = parseInt(process.env.FLAKY_ITERATIONS || '10', 10);
  const pattern = process.argv[2] || process.env.FLAKY_TEST_PATTERN || 'src/__tests__/flakyRetry.test.ts';
  const result = runFlakyDetection(iterations, pattern);
  if (result.failed > 0) {
    process.exit(1);
  }
}
