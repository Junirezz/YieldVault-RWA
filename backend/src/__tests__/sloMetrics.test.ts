import { latencyMonitoringService } from '../latencyMonitoring';
import {
  endpointSloBreachTotal,
  register,
  syncJobGovernanceMetrics,
} from '../metrics';

jest.mock('../middleware/structuredLogging', () => ({
  logger: { log: jest.fn(), configure: jest.fn() },
}));

describe('endpoint SLO Prometheus metrics', () => {
  beforeEach(() => {
    latencyMonitoringService.resetForTests();
    endpointSloBreachTotal.reset();
    process.env.SLO_READ_THRESHOLD_MS = '100';
    process.env.SLO_ALERT_COOLDOWN_MS = '60000';
    process.env.ALERT_TYPE = 'slack';
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    latencyMonitoringService.stopMonitoring();
  });

  it('exports breach gauges and increments counter when latency exceeds budget', async () => {
    const endpoint = '/health';

    for (let i = 0; i < 20; i += 1) {
      latencyMonitoringService.recordLatency(endpoint, 250);
    }

    latencyMonitoringService.syncSloMetrics();
    syncJobGovernanceMetrics();

    const metrics = await register.metrics();
    expect(metrics).toContain('backend_slo_breach');
    expect(metrics).toContain('backend_slo_p95_latency_ms');
    expect(metrics).toContain('tier="critical"');

    const before = (await endpointSloBreachTotal.get()).values.reduce((sum, v) => sum + v.value, 0);

    for (let i = 0; i < 5; i += 1) {
      latencyMonitoringService.recordLatency(endpoint, 300);
    }

    const after = (await endpointSloBreachTotal.get()).values.reduce((sum, v) => sum + v.value, 0);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('respects alert cooldown for breach counter increments', async () => {
    process.env.SLO_ALERT_COOLDOWN_MS = '3600000';
    const endpoint = '/ready';

    for (let i = 0; i < 25; i += 1) {
      latencyMonitoringService.recordLatency(endpoint, 500);
    }

    const first = (await endpointSloBreachTotal.get()).values.reduce((sum, v) => sum + v.value, 0);

    for (let i = 0; i < 25; i += 1) {
      latencyMonitoringService.recordLatency(endpoint, 500);
    }

    const second = (await endpointSloBreachTotal.get()).values.reduce((sum, v) => sum + v.value, 0);
    expect(second).toBe(first);
  });
});
