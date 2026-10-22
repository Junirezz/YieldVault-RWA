/**
 * @file alerting.ts
 * Protocol-level alerting for threshold breaches and critical events.
 *
 * Centralises alert routing so latency monitoring, exposure guardrails, and
 * other subsystems have a single, consistent way to raise an alert.  The
 * module is intentionally thin: it owns threshold comparison and logging but
 * delegates notification delivery to the caller-supplied channels.
 *
 * Issue #1373 — the Logger type passed to createAlertingService must include
 * `error` and `warn`.  The `Logger` interface exported from
 * `middleware/structuredLogging` satisfies that requirement.
 */

import type { Logger } from './middleware/structuredLogging';
import { logger as defaultLogger } from './middleware/structuredLogging';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'warning' | 'critical';

/** Describes a single threshold breach that should be surfaced to operators. */
export interface AlertEvent {
  /** Human-readable identifier for the check that fired. */
  name: string;
  severity: AlertSeverity;
  /** Observed value that exceeded the threshold. */
  value: number;
  /** The threshold that was breached. */
  threshold: number;
  /** Additional structured context for the alert. */
  metadata?: Record<string, unknown>;
}

/** Delivery channel that receives formatted alerts. */
export interface AlertChannel {
  send(event: AlertEvent): Promise<void>;
}

/** Public surface of the alerting service. */
export interface AlertingService {
  /**
   * Evaluate `value` against `threshold`.  Fires a 'warning' when
   * `warnRatio` is exceeded and a 'critical' alert when `critRatio` is
   * exceeded (both ratios relative to `threshold`).
   */
  evaluate(
    name: string,
    value: number,
    threshold: number,
    options?: EvaluateOptions,
  ): Promise<void>;

  /** Raise an alert unconditionally. */
  raise(event: AlertEvent): Promise<void>;
}

export interface EvaluateOptions {
  /** Fraction of threshold at which a 'warning' fires (default 0.8). */
  warnRatio?: number;
  /** Fraction of threshold at which a 'critical' fires (default 1.0). */
  critRatio?: number;
  /** Extra metadata to attach to the fired event. */
  metadata?: Record<string, unknown>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

class AlertingServiceImpl implements AlertingService {
  private readonly log: Logger;
  private readonly channels: AlertChannel[];

  constructor(log: Logger, channels: AlertChannel[]) {
    this.log = log;
    this.channels = channels;
  }

  async evaluate(
    name: string,
    value: number,
    threshold: number,
    options: EvaluateOptions = {},
  ): Promise<void> {
    const { warnRatio = 0.8, critRatio = 1.0, metadata } = options;

    const warnThreshold = threshold * warnRatio;
    const critThreshold = threshold * critRatio;

    if (value >= critThreshold) {
      await this.raise({
        name,
        severity: 'critical',
        value,
        threshold,
        metadata,
      });
    } else if (value >= warnThreshold) {
      await this.raise({
        name,
        severity: 'warning',
        value,
        threshold,
        metadata,
      });
    }
  }

  async raise(event: AlertEvent): Promise<void> {
    const logFields = {
      alertName: event.name,
      severity: event.severity,
      value: event.value,
      threshold: event.threshold,
      ...event.metadata,
    };

    if (event.severity === 'critical') {
      this.log.error(`[alerting] Critical threshold breach: ${event.name}`, logFields);
    } else {
      this.log.warn(`[alerting] Warning threshold breach: ${event.name}`, logFields);
    }

    const deliveries = this.channels.map((ch) =>
      ch.send(event).catch((err: unknown) => {
        this.log.error('[alerting] Alert channel delivery failed', {
          alertName: event.name,
          channel: ch.constructor.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    );

    await Promise.all(deliveries);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an alerting service.
 *
 * @param channels - One or more delivery channels (Slack, PagerDuty, …).
 * @param log      - Logger instance.  Defaults to the shared structured logger.
 *                   Must expose `error` and `warn` (see issue #1373).
 */
export function createAlertingService(
  channels: AlertChannel[] = [],
  log: Logger = defaultLogger,
): AlertingService {
  return new AlertingServiceImpl(log, channels);
}

/** Pre-built singleton backed by the default structured logger. */
export const alertingService: AlertingService = createAlertingService();
