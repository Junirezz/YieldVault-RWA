import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a Registry which registers the metrics
export const register = new Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'yieldvault-backend'
});

// Enable the collection of default metrics
collectDefaultMetrics({ register });

// --- Standard HTTP Metrics ---

export const httpRequestCount = new Counter({
  name: 'http_request_count',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpResponseTime = new Histogram({
  name: 'http_response_time_seconds',
  help: 'Histogram of HTTP response time in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // Define custom buckets for response time
  registers: [register],
});

export const activeConnections = new Gauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

// --- Vault Specific Metrics ---

export const vaultTvl = new Gauge({
  name: 'vault_tvl_usd',
  help: 'Current Total Value Locked (TVL) in USD',
  registers: [register],
});

export const vaultSharePrice = new Gauge({
  name: 'vault_share_price_usd',
  help: 'Current vault share price in USD',
  registers: [register],
});

/**
 * Updates vault-specific gauges
 * @param tvl Current TVL value
 * @param sharePrice Current share price value
 */
export function updateVaultMetrics(tvl: number, sharePrice: number) {
  vaultTvl.set(tvl);
  vaultSharePrice.set(sharePrice);
}
