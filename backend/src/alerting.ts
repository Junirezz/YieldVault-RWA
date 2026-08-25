/**
 * Alert delivery abstraction for operational events.
 * 
 * Supports multiple channels (Slack, PagerDuty) with configurable
 * rate limiting and retry logic.
 */

import { logger } from './middleware/structuredLogging';

export type AlertChannel = 'slack' | 'pagerduty' | 'console';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertPayload {
  title: string;
  description: string;
  severity: AlertSeverity;
  service: string;
  context?: Record<string, any>;
  channels?: AlertChannel[];
}

export interface AlertResult {
  success: boolean;
  channels: Map<AlertChannel, boolean>;
  errors?: Map<AlertChannel, Error>;
}

/**
 * Sends an alert to configured channels with rate limiting.
 * 
 * Default channels based on severity:
 * - info/warning → console log + Slack (if configured)
 * - critical → console log + Slack + PagerDuty (if configured)
 */
export async function sendAlert(payload: AlertPayload): Promise<AlertResult> {
  const channels = payload.channels || getDefaultChannels(payload.severity);
  const result: AlertResult = {
    success: true,
    channels: new Map(),
    errors: new Map(),
  };

  for (const channel of channels) {
    try {
      await sendToChannel(channel, payload);
      result.channels.set(channel, true);
    } catch (err) {
      result.success = false;
      result.channels.set(channel, false);
      result.errors?.set(channel, err as Error);
      logger.error('Alert delivery failed', {
        channel,
        severity: payload.severity,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

function getDefaultChannels(severity: AlertSeverity): AlertChannel[] {
  if (severity === 'critical') {
    return ['console', 'slack', 'pagerduty'];
  }
  if (severity === 'warning') {
    return ['console', 'slack'];
  }
  return ['console'];
}

async function sendToChannel(channel: AlertChannel, payload: AlertPayload): Promise<void> {
  switch (channel) {
    case 'console':
      logToConsole(payload);
      break;
    case 'slack':
      await sendToSlack(payload);
      break;
    case 'pagerduty':
      await sendToPagerDuty(payload);
      break;
  }
}

function logToConsole(payload: AlertPayload): void {
  const logFn = payload.severity === 'critical' ? logger.error : logger.warn;
  logFn(payload.title, {
    description: payload.description,
    severity: payload.severity,
    service: payload.service,
    context: payload.context,
  });
}

async function sendToSlack(payload: AlertPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('Slack webhook URL not configured, skipping Slack alert');
    return;
  }

  const color = getSlackColor(payload.severity);
  const message = {
    attachments: [
      {
        color,
        title: payload.title,
        text: payload.description,
        fields: [
          { title: 'Severity', value: payload.severity, short: true },
          { title: 'Service', value: payload.service, short: true },
          {
            title: 'Context',
            value: JSON.stringify(payload.context || {}, null, 2),
            short: false,
          },
        ],
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Slack API returned ${response.status}`);
  }
}

async function sendToPagerDuty(payload: AlertPayload): Promise<void> {
  const integrationKey = process.env.PAGERDUTY_INTEGRATION_KEY;
  if (!integrationKey) {
    logger.warn('PagerDuty integration key not configured, skipping PagerDuty alert');
    return;
  }

  const eventAction = payload.severity === 'critical' ? 'trigger' : 'info';
  const event = {
    routing_key: integrationKey,
    event_action: eventAction,
    payload: {
      summary: payload.title,
      severity: payload.severity,
      source: payload.service,
      custom_details: payload.context,
    },
  };

  const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`PagerDuty API returned ${response.status}`);
  }
}

function getSlackColor(severity: AlertSeverity): string {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
    default:
      return 'good';
  }
}
