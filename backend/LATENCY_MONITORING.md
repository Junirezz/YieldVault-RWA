# API Latency SLO Monitoring

This document describes the implemented API latency monitoring system that automatically alerts on-call engineers when API endpoints breach latency SLOs.

## Overview

The latency monitoring system tracks P95 latency for all API endpoints and sends alerts when the 5-minute rolling P95 exceeds configured SLO thresholds.

## Features

- **Real-time latency tracking** for all API endpoints
- **P95 latency calculation** with configurable rolling windows
- **SLO breach detection** with automatic alerting
- **Multiple alert integrations** (Slack, PagerDuty)
- **Configurable thresholds** via environment variables
- **Endpoint normalization** for dynamic routes
- **Admin endpoints** for monitoring status

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# SLO thresholds in milliseconds
SLO_READ_THRESHOLD_MS=200
SLO_WRITE_THRESHOLD_MS=500

# Evaluation window for P95 calculation (5 minutes = 300000 ms)
SLO_EVALUATION_WINDOW_MS=300000

# Alert cooldown period to prevent spam (15 minutes = 900000 ms)
SLO_ALERT_COOLDOWN_MS=900000

# SLO check interval (1 minute = 60000 ms)
SLO_CHECK_INTERVAL_MS=60000

# Alert Integration Configuration
# Set to 'slack', 'pagerduty', or 'both'
ALERT_TYPE=slack

# Slack Webhook URL (required if ALERT_TYPE includes 'slack')
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# PagerDuty Integration Key (required if ALERT_TYPE includes 'pagerduty')
PAGERDUTY_INTEGRATION_KEY=your-pagerduty-integration-key
```

### Endpoint Categorization

Endpoints are automatically categorized as:

**Read Endpoints (200ms SLO):**
- `/api/v1/vault/summary`
- `/api/v1/vault/metrics`
- `/api/v1/vault/apy`
- `/api/v1/vault/:id`
- `/health`
- `/ready`
- `/metrics`

**Write Endpoints (500ms SLO):**
- `/api/v1/vault/deposit`
- `/api/v1/vault/withdraw`
- `/api/v1/vault/create`
- `/admin/cache/invalidate`
- `/admin/api-keys/register`

## Alert Integrations

### Slack Configuration

1. Create a Slack webhook URL
2. Set `ALERT_TYPE=slack`
3. Set `SLACK_WEBHOOK_URL` to your webhook URL

**Sample Slack Alert:**
```
🚨 API Latency SLO Breach Detected

Affected Endpoints:
• /api/v1/vault/summary: P95 = 245.50ms (SLO: 200ms, 45 samples)

Time: 2026-04-25T19:22:19.132Z
Service: YieldVault Backend
```

### PagerDuty Configuration

1. Create a PagerDuty integration
2. Set `ALERT_TYPE=pagerduty`
3. Set `PAGERDUTY_INTEGRATION_KEY` to your integration key

**PagerDuty Alert Details:**
- **Severity:** Critical
- **Component:** api-latency-monitoring
- **Group:** performance
- **Class:** latency-slo

## Monitoring Endpoints

### Admin Endpoints (API Key Required)

#### GET `/admin/latency-status`
Returns detailed latency monitoring status and metrics.

**Response:**
```json
{
  "status": {
    "endpointsTracked": 12,
    "monitoringActive": true,
    "alertIntegrations": ["SlackAlert"]
  },
  "metrics": [
    {
      "endpoint": "/api/v1/vault/summary",
      "type": "read",
      "currentP95": 150.25,
      "threshold": 200,
      "isBreaching": false,
      "dataPoints": 45,
      "lastAlertTime": null
    }
  ],
  "timestamp": "2026-04-25T19:22:19.132Z"
}
```

## Acceptance Criteria Met

✅ **Alert fires within 5 minutes of an SLO breach**
- SLO check interval runs every 1 minute (configurable)
- 5-minute rolling window ensures detection within 5 minutes

✅ **Alert message includes required information**
- Endpoint name
- Current P95 value  
- SLO threshold
- Number of samples
- Timestamp

✅ **Alerting channel is configurable via environment variable**
- `ALERT_TYPE` controls integration (slack/pagerduty/both)
- Individual webhook/integration keys configurable

## Implementation Details

### Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Express App   │───▶│ Latency Tracker  │───▶│ Alert Service   │
│                 │    │                  │    │                 │
│ - Middleware    │    │ - P95 Calculation │    │ - Slack Webhook │
│ - Route Handler │    │ - SLO Detection   │    │ - PagerDuty API │
│ - Metrics       │    │ - Rolling Window  │    │ - Cooldown      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Data Flow

1. **Request Processing:** Express middleware records latency for each successful request
2. **Endpoint Normalization:** Dynamic paths normalized (e.g., `/api/v1/vault/123` → `/api/v1/vault/:id`)
3. **Latency Storage:** Measurements stored in rolling window per endpoint
4. **P95 Calculation:** P95 calculated for each endpoint's measurements
5. **SLO Evaluation:** P95 compared against endpoint-specific thresholds
6. **Alert Dispatch:** Alerts sent when SLO breached and cooldown expired

### Performance Considerations

- **Memory Usage:** Only stores latency data within evaluation window
- **CPU Usage:** Efficient P95 calculation with sorting
- **Network:** Alert batching and cooldown prevent spam
- **Scalability:** Per-endpoint tracking scales with API surface area

## Testing

### Integration Test

Run the integration test to verify functionality:

```bash
npx tsx src/integration-test.ts
```

### Unit Tests

Run unit tests (when available):

```bash
npm test -- latencyMonitoring.test.ts
```

## Troubleshooting

### Common Issues

**Alerts not firing:**
1. Check `ALERT_TYPE` configuration
2. Verify webhook/integration keys
3. Check if endpoints have enough traffic (need samples for P95)
4. Verify SLO thresholds are appropriate

**High memory usage:**
1. Reduce `SLO_EVALUATION_WINDOW_MS`
2. Check for endpoint explosion (too many unique endpoints)

**Missing endpoints:**
1. Verify middleware is properly integrated
2. Check if requests are successful (only 2xx-3xx tracked)
3. Verify endpoint normalization logic

### Debug Information

Enable debug logging by setting `LOG_LEVEL=debug` in your environment.

## Future Enhancements

- **Dynamic SLO adjustment** based on traffic patterns
- **Multi-dimensional alerting** (error rate + latency)
- **Historical trend analysis** 
- **Dashboard integration**
- **Automated SLO recommendations**
- **Geographic latency tracking**

## Security Considerations

- Admin endpoints require API key authentication
- Webhook URLs should be kept secret
- Alert data doesn't contain sensitive request information
- Rate limiting applies to monitoring endpoints
