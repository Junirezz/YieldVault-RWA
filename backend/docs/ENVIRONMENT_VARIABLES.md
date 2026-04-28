# Environment Variables - Latency Monitoring System

This document outlines all environment variables used by the latency monitoring and alerting system.

## Required Variables

### Alerting Configuration
- `ALERT_TYPE` - Alert integration to use (default: `slack`)
  - Values: `slack`, `pagerduty`, `both`

#### For Slack Integration
- `SLACK_WEBHOOK_URL` - Slack webhook URL for sending alerts
  - Required if `ALERT_TYPE` includes `slack`
  - Format: `https://hooks.slack.com/services/<TEAM>/<CHANNEL>/<TOKEN>`

#### For PagerDuty Integration
- `PAGERDUTY_INTEGRATION_KEY` - PagerDuty integration key for sending alerts
  - Required if `ALERT_TYPE` includes `pagerduty`
  - Format: Integration key from PagerDuty

## Optional Variables

### SLO Configuration
- `SLO_READ_THRESHOLD_MS` - P95 latency threshold for read endpoints (default: `200`)
- `SLO_WRITE_THRESHOLD_MS` - P95 latency threshold for write endpoints (default: `500`)
- `SLO_EVALUATION_WINDOW_MS` - Rolling window for P95 calculation in milliseconds (default: `300000` = 5 minutes)
- `SLO_ALERT_COOLDOWN_MS` - Cooldown between alerts for same endpoint in milliseconds (default: `900000` = 15 minutes)
- `SLO_CHECK_INTERVAL_MS` - How often to check for SLO violations in milliseconds (default: `60000` = 1 minute)

## Example Configuration

### Development Environment
```bash
# Alert to Slack only
ALERT_TYPE=slack
SLACK_WEBHOOK_URL=<your-slack-webhook-url>

# Use shorter intervals for testing
SLO_EVALUATION_WINDOW_MS=60000    # 1 minute
SLO_ALERT_COOLDOWN_MS=30000       # 30 seconds
SLO_CHECK_INTERVAL_MS=10000       # 10 seconds
```

### Production Environment
```bash
# Alert to both Slack and PagerDuty
ALERT_TYPE=both
SLACK_WEBHOOK_URL=<your-slack-webhook-url>
PAGERDUTY_INTEGRATION_KEY=your-integration-key

# Production defaults (can be omitted)
SLO_READ_THRESHOLD_MS=200
SLO_WRITE_THRESHOLD_MS=500
SLO_EVALUATION_WINDOW_MS=300000   # 5 minutes
SLO_ALERT_COOLDOWN_MS=900000      # 15 minutes
SLO_CHECK_INTERVAL_MS=60000       # 1 minute
```

## Security Notes

- Keep webhook URLs and integration keys secure
- Use environment-specific configurations
- Never commit sensitive values to version control
- Consider using secret management systems in production

## Monitoring Endpoints

The system automatically categorizes these endpoints:

### Read Endpoints (200ms SLO)
- `/api/v1/vault/summary`
- `/api/v1/vault/metrics`
- `/api/v1/vault/apy`
- `/api/v1/vault/:id`
- `/health`
- `/ready`
- `/metrics`

### Write Endpoints (500ms SLO)
- `/api/v1/vault/deposit`
- `/api/v1/vault/withdraw`
- `/api/v1/vault/create`
- `/admin/cache/invalidate`
- `/admin/api-keys/register`

Unknown endpoints default to READ type with the read SLO threshold.
