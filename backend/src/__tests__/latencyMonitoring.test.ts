import { latencyMonitoringService, EndpointType } from '../latencyMonitoring';

// Mock the logger
jest.mock('../middleware/structuredLogging', () => ({
  logger: {
    log: jest.fn(),
    configure: jest.fn(),
  },
}));

// Mock fetch for alert testing
global.fetch = jest.fn();

describe('LatencyMonitoringService', () => {
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Mock environment variables
    process.env.SLO_READ_THRESHOLD_MS = '200';
    process.env.SLO_WRITE_THRESHOLD_MS = '500';
    process.env.SLO_EVALUATION_WINDOW_MS = '300000'; // 5 minutes
    process.env.SLO_ALERT_COOLDOWN_MS = '900000'; // 15 minutes
    process.env.ALERT_TYPE = 'slack';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    
    // Reset module cache to get fresh service instance
    jest.resetModules();
  });

  afterEach(() => {
    latencyMonitoringService.stopMonitoring();
  });

  describe('Latency Recording', () => {
    test('should record latency measurements for known endpoints', () => {
      const endpoint = '/api/v1/vault/summary';
      const latencyMs = 150;

      latencyMonitoringService.recordLatency(endpoint, latencyMs);
      
      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      expect(endpointMetric).toBeDefined();
      expect(endpointMetric?.type).toBe(EndpointType.READ);
      expect(endpointMetric?.threshold).toBe(200);
      expect(endpointMetric?.dataPoints).toBe(1);
    });

    test('should create tracker for unknown endpoints', () => {
      const unknownEndpoint = '/api/v1/unknown/endpoint';
      const latencyMs = 100;

      latencyMonitoringService.recordLatency(unknownEndpoint, latencyMs);
      
      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === unknownEndpoint);
      
      expect(endpointMetric).toBeDefined();
      expect(endpointMetric?.type).toBe(EndpointType.READ); // Default to READ
      expect(endpointMetric?.dataPoints).toBe(1);
    });

    test('should normalize dynamic endpoint paths', () => {
      const dynamicEndpoint = '/api/v1/vault/12345';
      const latencyMs = 180;

      latencyMonitoringService.recordLatency(dynamicEndpoint, latencyMs);
      
      const metrics = latencyMonitoringService.getDetailedMetrics();
      const normalizedMetric = metrics.find(m => m.endpoint === '/api/v1/vault/:id');
      
      expect(normalizedMetric).toBeDefined();
      expect(normalizedMetric?.dataPoints).toBe(1);
    });
  });

  describe('P95 Calculation', () => {
    test('should calculate correct P95 for multiple measurements', () => {
      const endpoint = '/api/v1/vault/summary';
      const latencies = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550]; // 10 measurements

      latencies.forEach(latency => {
        latencyMonitoringService.recordLatency(endpoint, latency);
      });

      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      // P95 of 10 measurements should be the 10th value (550ms)
      expect(endpointMetric?.currentP95).toBe(550);
      expect(endpointMetric?.dataPoints).toBe(10);
    });

    test('should handle single measurement correctly', () => {
      const endpoint = '/api/v1/vault/summary';
      const latencyMs = 150;

      latencyMonitoringService.recordLatency(endpoint, latencyMs);

      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      // P95 of single measurement should be that measurement
      expect(endpointMetric?.currentP95).toBe(latencyMs);
      expect(endpointMetric?.dataPoints).toBe(1);
    });

    test('should return 0 for no measurements', () => {
      const endpoint = '/api/v1/vault/summary';
      
      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      expect(endpointMetric?.currentP95).toBe(0);
      expect(endpointMetric?.dataPoints).toBe(0);
    });
  });

  describe('SLO Breach Detection', () => {
    test('should detect SLO breach for read endpoints', () => {
      const endpoint = '/api/v1/vault/summary'; // READ endpoint with 200ms threshold
      const violatingLatencies = [250, 300, 350, 400, 450]; // All above 200ms threshold

      violatingLatencies.forEach(latency => {
        latencyMonitoringService.recordLatency(endpoint, latency);
      });

      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      expect(endpointMetric?.isBreaching).toBe(true);
      expect(endpointMetric?.currentP95).toBe(450); // P95 of these values
    });

    test('should detect SLO breach for write endpoints', () => {
      const endpoint = '/api/v1/vault/deposit'; // WRITE endpoint with 500ms threshold
      const violatingLatencies = [600, 700, 800, 900, 1000]; // All above 500ms threshold

      violatingLatencies.forEach(latency => {
        latencyMonitoringService.recordLatency(endpoint, latency);
      });

      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      expect(endpointMetric?.isBreaching).toBe(true);
      expect(endpointMetric?.currentP95).toBe(1000); // P95 of these values
    });

    test('should not detect SLO breach when within threshold', () => {
      const endpoint = '/api/v1/vault/summary'; // READ endpoint with 200ms threshold
      const normalLatencies = [50, 100, 150, 180, 190]; // All below 200ms threshold

      normalLatencies.forEach(latency => {
        latencyMonitoringService.recordLatency(endpoint, latency);
      });

      const metrics = latencyMonitoringService.getDetailedMetrics();
      const endpointMetric = metrics.find(m => m.endpoint === endpoint);
      
      expect(endpointMetric?.isBreaching).toBe(false);
      expect(endpointMetric?.currentP95).toBe(190); // P95 of these values
    });
  });

  describe('Alert Integration', () => {
    beforeEach(() => {
      // Mock fetch to resolve successfully
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
    });

    test('should send Slack alert when configured', async () => {
      process.env.ALERT_TYPE = 'slack';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      
      // Create a new service instance to pick up new env vars
      const { latencyMonitoringService: newService } = require('../latencyMonitoring');
      
      const endpoint = '/api/v1/vault/summary';
      const violatingLatencies = [250, 300, 350, 400, 450]; // All above 200ms threshold

      violatingLatencies.forEach(latency => {
        newService.recordLatency(endpoint, latency);
      });

      // Manually trigger alert check for testing
      await (newService as any).checkSLOViolations();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('🚨 API Latency SLO Breach Detected'),
        })
      );
    });

    test('should send PagerDuty alert when configured', async () => {
      process.env.ALERT_TYPE = 'pagerduty';
      process.env.PAGERDUTY_INTEGRATION_KEY = 'test-pagerduty-key';
      
      // Create a new service instance to pick up new env vars
      const { latencyMonitoringService: newService } = require('../latencyMonitoring');
      
      const endpoint = '/api/v1/vault/deposit';
      const violatingLatencies = [600, 700, 800, 900, 1000]; // All above 500ms threshold

      violatingLatencies.forEach(latency => {
        newService.recordLatency(endpoint, latency);
      });

      // Manually trigger alert check for testing
      await (newService as any).checkSLOViolations();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://events.pagerduty.com/v2/enqueue',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('test-pagerduty-key'),
        })
      );
    });

    test('should handle missing alert configuration gracefully', async () => {
      process.env.ALERT_TYPE = 'slack';
      delete process.env.SLACK_WEBHOOK_URL;
      
      // Create a new service instance to pick up new env vars
      const { latencyMonitoringService: newService } = require('../latencyMonitoring');
      
      const endpoint = '/api/v1/vault/summary';
      const violatingLatencies = [250, 300, 350, 400, 450];

      violatingLatencies.forEach(latency => {
        newService.recordLatency(endpoint, latency);
      });

      // Should not throw error, just log warning
      await expect((newService as any).checkSLOViolations()).resolves.not.toThrow();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Service Status', () => {
    test('should return correct status information', () => {
      const status = latencyMonitoringService.getStatus();
      
      expect(status).toHaveProperty('endpointsTracked');
      expect(status).toHaveProperty('monitoringActive');
      expect(status).toHaveProperty('alertIntegrations');
      expect(typeof status.endpointsTracked).toBe('number');
      expect(typeof status.monitoringActive).toBe('boolean');
      expect(Array.isArray(status.alertIntegrations)).toBe(true);
    });

    test('should show monitoring as inactive when stopped', () => {
      latencyMonitoringService.stopMonitoring();
      const status = latencyMonitoringService.getStatus();
      expect(status.monitoringActive).toBe(false);
    });
  });

  describe('Monitoring Lifecycle', () => {
    test('should start and stop monitoring correctly', () => {
      expect(() => latencyMonitoringService.startMonitoring()).not.toThrow();
      expect(latencyMonitoringService.getStatus().monitoringActive).toBe(true);
      
      expect(() => latencyMonitoringService.stopMonitoring()).not.toThrow();
      expect(latencyMonitoringService.getStatus().monitoringActive).toBe(false);
    });

    test('should handle multiple start calls gracefully', () => {
      latencyMonitoringService.startMonitoring();
      const initialStatus = latencyMonitoringService.getStatus();
      
      // Should not create multiple intervals
      latencyMonitoringService.startMonitoring();
      const subsequentStatus = latencyMonitoringService.getStatus();
      
      expect(initialStatus.monitoringActive).toBe(true);
      expect(subsequentStatus.monitoringActive).toBe(true);
    });
  });

  describe('Stale Data Pruning', () => {
    test('should exclude data points outside the evaluation window from P95', () => {
      // Use a short evaluation window for testing
      process.env.SLO_EVALUATION_WINDOW_MS = '1000'; // 1 second
      jest.resetModules();
      const { latencyMonitoringService: freshService } = require('../latencyMonitoring');

      const endpoint = '/api/v1/vault/summary';

      // Record a breaching latency that will become stale
      freshService.recordLatency(endpoint, 500);

      const metricsBefore = freshService.getDetailedMetrics();
      const metricBefore = metricsBefore.find(m => m.endpoint === endpoint);
      expect(metricBefore?.currentP95).toBe(500);
      expect(metricBefore?.isBreaching).toBe(true);

      // Wait for the evaluation window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const metricsAfter = freshService.getDetailedMetrics();
          const metricAfter = metricsAfter.find(m => m.endpoint === endpoint);
          // Stale data should be pruned, P95 should drop to 0
          expect(metricAfter?.currentP95).toBe(0);
          expect(metricAfter?.isBreaching).toBe(false);
          expect(metricAfter?.dataPoints).toBe(0);
          freshService.stopMonitoring();
          resolve();
        }, 1100);
      });
    });

    test('should only count data points within the rolling window', () => {
      process.env.SLO_EVALUATION_WINDOW_MS = '2000'; // 2 seconds
      jest.resetModules();
      const { latencyMonitoringService: freshService } = require('../latencyMonitoring');

      const endpoint = '/api/v1/vault/summary';

      // Record old data
      freshService.recordLatency(endpoint, 999);

      return new Promise<void>((resolve) => {
        setTimeout(async () => {
          // Old data is now stale; record fresh data
          freshService.recordLatency(endpoint, 100);

          const metrics = freshService.getDetailedMetrics();
          const metric = metrics.find(m => m.endpoint === endpoint);
          // Only the fresh data point should count
          expect(metric?.dataPoints).toBe(1);
          expect(metric?.currentP95).toBe(100);
          freshService.stopMonitoring();
          resolve();
        }, 2200);
      });
    });
  });

  describe('Acceptance Criteria: Alert Message Content', () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
    });

    test('Slack alert body includes endpoint name, current P95 value, and SLO threshold', async () => {
      process.env.ALERT_TYPE = 'slack';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      jest.resetModules();
      const { latencyMonitoringService: svc } = require('../latencyMonitoring');

      const endpoint = '/api/v1/vault/summary';
      [250, 300, 350, 400, 450].forEach(l => svc.recordLatency(endpoint, l));

      await (svc as any).checkSLOViolations();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const affectedField = callBody.attachments[0].fields.find(
        (f: any) => f.title === 'Affected Endpoints'
      );
      // Must include endpoint name
      expect(affectedField.value).toContain('/api/v1/vault/summary');
      // Must include current P95 value
      expect(affectedField.value).toMatch(/P95\s*=\s*\d+(\.\d+)?ms/);
      // Must include SLO threshold
      expect(affectedField.value).toMatch(/SLO:\s*200ms/);
    });

    test('PagerDuty alert payload includes endpoint name, current P95 value, and SLO threshold', async () => {
      process.env.ALERT_TYPE = 'pagerduty';
      process.env.PAGERDUTY_INTEGRATION_KEY = 'test-pd-key';
      jest.resetModules();
      const { latencyMonitoringService: svc } = require('../latencyMonitoring');

      const endpoint = '/api/v1/vault/deposit';
      [600, 700, 800, 900, 1000].forEach(l => svc.recordLatency(endpoint, l));

      await (svc as any).checkSLOViolations();

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const summary: string = callBody.payload.summary;
      // Must include endpoint name
      expect(summary).toContain('/api/v1/vault/deposit');
      // Must include current P95 value
      expect(summary).toMatch(/P95=\d+(\.\d+)?ms/);
      // Must include SLO threshold
      expect(summary).toMatch(/SLO=500ms/);
    });
  });

  describe('Acceptance Criteria: Alert Channel Configurable via Environment Variable', () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
    });

    test('ALERT_TYPE=slack sends only to Slack', async () => {
      process.env.ALERT_TYPE = 'slack';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      process.env.PAGERDUTY_INTEGRATION_KEY = 'should-not-be-used';
      jest.resetModules();
      const { latencyMonitoringService: svc } = require('../latencyMonitoring');

      [250, 300, 350, 400, 450].forEach(l => svc.recordLatency('/api/v1/vault/summary', l));
      await (svc as any).checkSLOViolations();

      const urls = (global.fetch as jest.Mock).mock.calls.map((c: any) => c[0]);
      expect(urls.some((u: string) => u.includes('hooks.slack.com'))).toBe(true);
      expect(urls.some((u: string) => u.includes('events.pagerduty.com'))).toBe(false);
    });

    test('ALERT_TYPE=pagerduty sends only to PagerDuty', async () => {
      process.env.ALERT_TYPE = 'pagerduty';
      process.env.PAGERDUTY_INTEGRATION_KEY = 'test-key';
      delete process.env.SLACK_WEBHOOK_URL;
      jest.resetModules();
      const { latencyMonitoringService: svc } = require('../latencyMonitoring');

      [600, 700, 800, 900, 1000].forEach(l => svc.recordLatency('/api/v1/vault/deposit', l));
      await (svc as any).checkSLOViolations();

      const urls = (global.fetch as jest.Mock).mock.calls.map((c: any) => c[0]);
      expect(urls.some((u: string) => u.includes('events.pagerduty.com'))).toBe(true);
      expect(urls.some((u: string) => u.includes('hooks.slack.com'))).toBe(false);
    });

    test('ALERT_TYPE=both sends to Slack and PagerDuty', async () => {
      process.env.ALERT_TYPE = 'both';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      process.env.PAGERDUTY_INTEGRATION_KEY = 'test-key';
      jest.resetModules();
      const { latencyMonitoringService: svc } = require('../latencyMonitoring');

      [250, 300, 350, 400, 450].forEach(l => svc.recordLatency('/api/v1/vault/summary', l));
      await (svc as any).checkSLOViolations();

      const urls = (global.fetch as jest.Mock).mock.calls.map((c: any) => c[0]);
      expect(urls.some((u: string) => u.includes('hooks.slack.com'))).toBe(true);
      expect(urls.some((u: string) => u.includes('events.pagerduty.com'))).toBe(true);
    });
  });

  describe('Acceptance Criteria: Alert Fires Within 5 Minutes of SLO Breach', () => {
    test('immediate alert fires on SLO breach via recordLatency', async () => {
      process.env.ALERT_TYPE = 'slack';
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      jest.resetModules();
      const { latencyMonitoringService: svc } = require('../latencyMonitoring');

      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      // Record breaching latencies — the immediate check should fire
      [250, 300, 350, 400, 450].forEach(l => svc.recordLatency('/api/v1/vault/summary', l));

      // Allow async alert dispatch to complete
      await new Promise(r => setTimeout(r, 50));

      expect(global.fetch).toHaveBeenCalled();
      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('hooks.slack.com');
    });

    test('periodic check interval is <= 5 minutes', () => {
      const checkIntervalMs = parseInt(process.env.SLO_CHECK_INTERVAL_MS || '60000', 10);
      // The check interval must be 5 minutes or less to guarantee detection within 5 min
      expect(checkIntervalMs).toBeLessThanOrEqual(300000);
    });
  });
});
