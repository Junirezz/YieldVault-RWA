import { logger } from './middleware/structuredLogging';
import { ENDPOINT_SLA_REGISTRY, resolveLatencyBudgetMs, EndpointType, getEndpointSla } from './endpointSlaRegistry';
import { recordSloBreachAlert, endpointSloP95LatencyMs, endpointSloBudgetMs, endpointSloBreach } from './metrics';

export { EndpointType } from './endpointSlaRegistry';

// SLO Configuration
export interface SLOConfig {
  readEndpoints: number; // P95 latency threshold in ms (default: 200ms)
  writeEndpoints: number; // P95 latency threshold in ms (default: 500ms)
  evaluationWindowMs: number; // Rolling window for P95 calculation (default: 5 minutes)
  alertCooldownMs: number; // Cooldown between alerts for same endpoint (default: 15 minutes)
}

// Latency data point
interface LatencyDataPoint {
  timestamp: number;
  latency: number; // in milliseconds
}

// Endpoint latency tracker
class EndpointLatencyTracker {
  private dataPoints: LatencyDataPoint[] = [];
  private cachedDataPoints: LatencyDataPoint[] = [];
  private uncachedDataPoints: LatencyDataPoint[] = [];
  private lastAlertTime: number = 0;

  constructor(
    private endpoint: string,
    private type: EndpointType,
    private sloThreshold: number,
    private evaluationWindowMs: number,
    private alertCooldownMs: number
  ) {}

  addLatencyMeasurement(latencyMs: number, cached?: boolean): void {
    const now = Date.now();
    const point: LatencyDataPoint = { timestamp: now, latency: latencyMs };
    this.dataPoints.push(point);
    if (cached === true) {
      this.cachedDataPoints.push(point);
    } else if (cached === false) {
      this.uncachedDataPoints.push(point);
    }

    // Prune stale data on every write
    this.pruneStaleData(now);
  }

  /**
   * Remove data points that fall outside the rolling evaluation window.
   */
  pruneStaleData(nowMs: number = Date.now()): void {
    const cutoffTime = nowMs - this.evaluationWindowMs;
    this.dataPoints = this.dataPoints.filter(point => point.timestamp > cutoffTime);
    this.cachedDataPoints = this.cachedDataPoints.filter(point => point.timestamp > cutoffTime);
    this.uncachedDataPoints = this.uncachedDataPoints.filter(point => point.timestamp > cutoffTime);
  }

  private computeP95(points: LatencyDataPoint[]): number {
    if (points.length === 0) return 0;
    const sorted = points.map(p => p.latency).sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[idx] ?? 0;
  }

  calculateP95(): number {
    this.pruneStaleData();
    return this.computeP95(this.dataPoints);
  }

  getCachedP95(): number | undefined {
    this.pruneStaleData();
    return this.cachedDataPoints.length > 0 ? this.computeP95(this.cachedDataPoints) : undefined;
  }

  getUncachedP95(): number | undefined {
    this.pruneStaleData();
    return this.uncachedDataPoints.length > 0 ? this.computeP95(this.uncachedDataPoints) : undefined;
  }

  isSLOBreached(): boolean {
    const p95 = this.calculateP95();
    return p95 > this.sloThreshold;
  }

  shouldAlert(): boolean {
    const now = Date.now();
    const cooldownExpired = now - this.lastAlertTime > this.alertCooldownMs;
    const isBreaching = this.isSLOBreached();
    const isFirstBreach = this.lastAlertTime === 0 && isBreaching;
    return isBreaching && (cooldownExpired || isFirstBreach);
  }

  recordAlert(): void {
    this.lastAlertTime = Date.now();
  }

  getCurrentP95(): number {
    return this.calculateP95();
  }

  getDataPointCount(): number {
    this.pruneStaleData();
    return this.dataPoints.length;
  }

  get endpointType(): EndpointType {
    return this.type;
  }

  get threshold(): number {
    return this.sloThreshold;
  }

  get alertTime(): number {
    return this.lastAlertTime;
  }

}

interface SLOViolation {
  endpoint: string;
  type: EndpointType;
  currentP95: number;
  threshold: number;
  dataPoints: number;
}

// Main latency monitoring service
export class LatencyMonitoringService {
  private trackers: Map<string, EndpointLatencyTracker> = new Map();
  private alertIntegrations: AlertIntegration[] = [];
  private monitoringInterval?: ReturnType<typeof setInterval>;

  constructor() {
    this.initializeEndpointMappings();
    this.initializeAlertIntegrations();
  }

  private initializeEndpointMappings(): void {
    const sloConfig = this.getSLOConfig();

    for (const entry of ENDPOINT_SLA_REGISTRY) {
      const threshold = resolveLatencyBudgetMs(
        entry.path,
        sloConfig.readEndpoints,
        sloConfig.writeEndpoints,
      );
      this.trackers.set(
        entry.path,
        new EndpointLatencyTracker(
          entry.path,
          entry.type,
          threshold,
          sloConfig.evaluationWindowMs,
          sloConfig.alertCooldownMs,
        ),
      );
    }
  }

  private initializeAlertIntegrations(): void {
    const alertType = process.env.ALERT_TYPE || 'slack';
    
    switch (alertType.toLowerCase()) {
      case 'pagerduty':
        this.alertIntegrations.push(new PagerDutyAlert());
        break;
      case 'slack':
        this.alertIntegrations.push(new SlackAlert());
        break;
      case 'both':
        this.alertIntegrations.push(new PagerDutyAlert());
        this.alertIntegrations.push(new SlackAlert());
        break;
      default:
        logger.log('warn', 'Unknown alert type configured, defaulting to Slack', { alertType });
        this.alertIntegrations.push(new SlackAlert());
    }
  }

  recordLatency(endpoint: string, latencyMs: number, cached?: boolean): void {
    // Normalize endpoint path (replace :id patterns)
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    const tracker = this.trackers.get(normalizedEndpoint);
    
    if (tracker) {
      tracker.addLatencyMeasurement(latencyMs, cached);
      
      // Check for immediate SLO breach after recording
      if (tracker.shouldAlert()) {
        // Trigger immediate alert check for this endpoint
        this.checkImmediateAlert(tracker, normalizedEndpoint);
      }
    } else {
      // Create a new tracker for unknown endpoints (default to READ type)
      const sloConfig = this.getSLOConfig();
      const newTracker = new EndpointLatencyTracker(
        normalizedEndpoint,
        EndpointType.READ,
        sloConfig.readEndpoints,
        sloConfig.evaluationWindowMs,
        sloConfig.alertCooldownMs
      );
      newTracker.addLatencyMeasurement(latencyMs, cached);
      this.trackers.set(normalizedEndpoint, newTracker);
      
      logger.log('info', 'Created new latency tracker for endpoint', {
        endpoint: normalizedEndpoint,
        latency: latencyMs,
      });
    }
  }

  private normalizeEndpoint(endpoint: string): string {
    if (this.trackers.has(endpoint)) {
      return endpoint;
    }

    // Convert dynamic paths like /api/v1/vault/123 to /api/v1/vault/:id
    if (endpoint.match(/^\/api\/v1\/vault\/[^/]+$/)) {
      return '/api/v1/vault/:id';
    }
    return endpoint;
  }

  startMonitoring(): void {
    if (this.monitoringInterval) {
      logger.log('warn', 'Latency monitoring already started');
      return;
    }

    const checkIntervalMs = parseInt(process.env.SLO_CHECK_INTERVAL_MS || '60000', 10); // 1 minute
    
    this.monitoringInterval = setInterval(() => {
      this.checkSLOViolations();
    }, checkIntervalMs);

    logger.log('info', 'Latency monitoring started', {
      checkIntervalMs,
      endpointsTracked: this.trackers.size,
    });
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      logger.log('info', 'Latency monitoring stopped');
    }
  }

  private async checkImmediateAlert(tracker: EndpointLatencyTracker, endpoint: string): Promise<void> {
    const violation: SLOViolation = {
      endpoint,
      type: tracker.endpointType,
      currentP95: tracker.getCurrentP95(),
      threshold: tracker.threshold,
      dataPoints: tracker.getDataPointCount(),
    };
    
    tracker.recordAlert();
    this.recordSloBreachMetric(endpoint, tracker.endpointType);
    await this.sendAlerts([violation]);
    
    logger.log('info', 'Immediate SLO breach alert triggered', {
      endpoint,
      currentP95: violation.currentP95,
      threshold: violation.threshold,
    });
  }

  private async checkSLOViolations(): Promise<void> {
    const violations: SLOViolation[] = [];

    this.trackers.forEach((tracker, endpoint) => {
      if (tracker.shouldAlert()) {
        violations.push({
          endpoint,
          type: tracker.endpointType,
          currentP95: tracker.getCurrentP95(),
          threshold: tracker.threshold,
          dataPoints: tracker.getDataPointCount(),
        });
        
        tracker.recordAlert();
        this.recordSloBreachMetric(endpoint, tracker.endpointType);
      }
    });

    if (violations.length > 0) {
      await this.sendAlerts(violations);
    }
  }

  private async sendAlerts(violations: SLOViolation[]): Promise<void> {
    const alertPromises = this.alertIntegrations.map(integration =>
      integration.sendAlert(violations)
    );

    try {
      await Promise.all(alertPromises);
      logger.log('info', 'SLO violation alerts sent', {
        violationsCount: violations.length,
        integrations: this.alertIntegrations.map(i => i.constructor.name),
      });
    } catch (error: any) {
      logger.log('error', 'Failed to send some alerts', { error: error.message });
    }
  }

  private recordSloBreachMetric(endpoint: string, type: EndpointType): void {
    const sla = getEndpointSla(endpoint);
    const tier = sla?.tier ?? 'unknown';
    recordSloBreachAlert(endpoint, tier, type);
  }

  /**
   * Syncs endpoint SLO state into Prometheus gauges.
   * Call before scraping /metrics.
   */
  syncSloMetrics(): void {
    const detailed = this.getDetailedMetrics();

    for (const metric of detailed) {
      const sla = getEndpointSla(metric.endpoint);
      const tier = sla?.tier ?? 'unknown';
      const labels = { path: metric.endpoint, tier, type: metric.type };

      endpointSloP95LatencyMs.set(labels, metric.currentP95);
      endpointSloBudgetMs.set(labels, metric.threshold);
      endpointSloBreach.set(labels, metric.isBreaching ? 1 : 0);
    }
  }

  resetForTests(): void {
    this.stopMonitoring();
    this.trackers.clear();
    this.alertIntegrations = [];
    this.initializeEndpointMappings();
    this.initializeAlertIntegrations();
  }

  private getSLOConfig(): SLOConfig {
    return {
      readEndpoints: parseInt(process.env.SLO_READ_THRESHOLD_MS || '200', 10),
      writeEndpoints: parseInt(process.env.SLO_WRITE_THRESHOLD_MS || '500', 10),
      evaluationWindowMs: parseInt(process.env.SLO_EVALUATION_WINDOW_MS || '300000', 10),
      alertCooldownMs: parseInt(process.env.SLO_ALERT_COOLDOWN_MS || '900000', 10),
    };
  }

  // Get current status for health checks
  getStatus(): {
    endpointsTracked: number;
    monitoringActive: boolean;
    alertIntegrations: string[];
  } {
    return {
      endpointsTracked: this.trackers.size,
      monitoringActive: !!this.monitoringInterval,
      alertIntegrations: this.alertIntegrations.map(i => i.constructor.name),
    };
  }

  // Get detailed metrics for debugging
  getDetailedMetrics(): Array<{
    endpoint: string;
    type: EndpointType;
    currentP95: number;
    threshold: number;
    isBreaching: boolean;
    dataPoints: number;
    lastAlertTime?: number;
    cachedP95?: number;
    uncachedP95?: number;
  }> {
    const metrics: Array<{
      endpoint: string;
      type: EndpointType;
      currentP95: number;
      threshold: number;
      isBreaching: boolean;
      dataPoints: number;
      lastAlertTime?: number;
      cachedP95?: number;
      uncachedP95?: number;
    }> = [];
    
    this.trackers.forEach((tracker, endpoint) => {
      metrics.push({
        endpoint,
        type: tracker.endpointType,
        currentP95: tracker.getCurrentP95(),
        threshold: tracker.threshold,
        isBreaching: tracker.isSLOBreached(),
        dataPoints: tracker.getDataPointCount(),
        lastAlertTime: tracker.alertTime || undefined,
        cachedP95: tracker.getCachedP95(),
        uncachedP95: tracker.getUncachedP95(),
      });
    });

    return metrics;
  }
}

// Alert integration interfaces
abstract class AlertIntegration {
  abstract sendAlert(violations: SLOViolation[]): Promise<void>;
}

class SlackAlert extends AlertIntegration {
  async sendAlert(violations: SLOViolation[]): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      logger.log('warn', 'Slack webhook URL not configured, skipping Slack alert');
      return;
    }

    const message = this.formatSlackMessage(violations);
    
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`Slack API responded with status: ${response.status}`);
      }

      logger.log('info', 'Slack alert sent successfully');
    } catch (error: any) {
      logger.log('error', 'Failed to send Slack alert', { error: error.message });
      throw error;
    }
  }

  private formatSlackMessage(violations: SLOViolation[]) {
    const violationTexts = violations.map((v: SLOViolation) => 
      `• ${v.endpoint}: P95 = ${v.currentP95.toFixed(2)}ms (SLO: ${v.threshold}ms, ${v.dataPoints} samples)`
    ).join('\n');

    return {
      text: '🚨 API Latency SLO Breach Detected',
      attachments: [
        {
          color: 'danger',
          fields: [
            {
              title: 'Affected Endpoints',
              value: violationTexts,
              short: false,
            },
            {
              title: 'Time',
              value: new Date().toISOString(),
              short: true,
            },
            {
              title: 'Service',
              value: 'YieldVault Backend',
              short: true,
            },
          ],
          footer: 'Latency Monitoring System',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };
  }
}

class PagerDutyAlert extends AlertIntegration {
  async sendAlert(violations: SLOViolation[]): Promise<void> {
    const integrationKey = process.env.PAGERDUTY_INTEGRATION_KEY;
    if (!integrationKey) {
      logger.log('warn', 'PagerDuty integration key not configured, skipping PagerDuty alert');
      return;
    }

    const payload = this.formatPagerDutyPayload(violations);
    
    try {
      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API responded with status: ${response.status}`);
      }

      logger.log('info', 'PagerDuty alert sent successfully');
    } catch (error: any) {
      logger.log('error', 'Failed to send PagerDuty alert', { error: error.message });
      throw error;
    }
  }

  private formatPagerDutyPayload(violations: SLOViolation[]) {
    const violationDetails = violations.map((v: SLOViolation) => 
      `${v.endpoint}: P95=${v.currentP95.toFixed(2)}ms (SLO=${v.threshold}ms)`
    ).join(', ');

    return {
      routing_key: process.env.PAGERDUTY_INTEGRATION_KEY,
      event_action: 'trigger',
      payload: {
        summary: `API Latency SLO Breach: ${violationDetails}`,
        source: 'yieldvault-backend',
        severity: 'critical',
        timestamp: new Date().toISOString(),
        component: 'api-latency-monitoring',
        group: 'performance',
        class: 'latency-slo',
        custom_details: {
          violations: violations,
          service: 'YieldVault Backend',
          monitoring_system: 'Latency SLO Monitor',
        },
      },
    };
  }
}

// Global instance
export const latencyMonitoringService = new LatencyMonitoringService();
