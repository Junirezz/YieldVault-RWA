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
});
