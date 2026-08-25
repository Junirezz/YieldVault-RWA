/**
 * Tests for job governance dead-letter metrics exposure (Issue #812).
 */

import { jobGovernanceStore, resetJobGovernance, JobName } from '../jobGovernance';
import { syncJobGovernanceMetrics, jobDeadLetterCount, jobHealthStatus, register } from '../metrics';

beforeEach(() => {
  resetJobGovernance();
});

describe('syncJobGovernanceMetrics', () => {
  it('exposes dead-letter count per job after recordDeadLetter', async () => {
    const jobName: JobName = 'priceRefresh';

    jobGovernanceStore.recordDeadLetter({
      jobName,
      attempts: 3,
      error: 'timeout',
      payload: null,
      failedAt: new Date().toISOString(),
    });

    syncJobGovernanceMetrics();

    const metricsText = await register.metrics();
    expect(metricsText).toMatch(/job_dead_letter_count\{[^}]*job_name="priceRefresh"[^}]*\}\s+1/);
  });

  it('sets job_health_status=0 for jobs with recurring failures', async () => {
    const jobName: JobName = 'positionReconciliation'; // deadLetterThreshold = 2

    // Record enough failures to cross the threshold
    for (let i = 0; i < 2; i++) {
      jobGovernanceStore.recordDeadLetter({
        jobName,
        attempts: 4,
        error: 'rpc error',
        payload: null,
        failedAt: new Date().toISOString(),
      });
    }

    syncJobGovernanceMetrics();

    const metricsText = await register.metrics();
    expect(metricsText).toMatch(/job_health_status\{[^}]*job_name="positionReconciliation"[^}]*\}\s+0/);
  });

  it('sets job_health_status=1 for jobs below recurring failure threshold', async () => {
    const jobName: JobName = 'priceRefresh'; // deadLetterThreshold = 3

    jobGovernanceStore.recordDeadLetter({
      jobName,
      attempts: 3,
      error: 'timeout',
      payload: null,
      failedAt: new Date().toISOString(),
    });

    syncJobGovernanceMetrics();

    // 1 failure < threshold of 3, so health should still be up (1)
    const metricsText = await register.metrics();
    expect(metricsText).toMatch(/job_health_status\{[^}]*job_name="priceRefresh"[^}]*\}\s+1/);
  });
});
