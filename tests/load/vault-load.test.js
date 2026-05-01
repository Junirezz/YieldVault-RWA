import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'https://yieldvault-backend-staging.vercel.app').replace(/\/$/, '');
const WALLET_ADDRESS = __ENV.WALLET_ADDRESS || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ASSET = __ENV.ASSET || 'USDC';
const AMOUNT = __ENV.AMOUNT || '100.0';
const METRICS_PATH = __ENV.METRICS_PATH || '/metrics';

function buildIdempotencyKey(prefix) {
  return `${prefix}-${__VU}-${__ITER}-${Date.now()}`;
}

export const options = {
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.001'],
  },
  scenarios: {
    deposits: {
      executor: 'ramping-vus',
      exec: 'depositScenario',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '1m', target: 0 },
      ],
    },
    withdrawals: {
      executor: 'ramping-vus',
      exec: 'withdrawalScenario',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '1m', target: 0 },
      ],
    },
    metrics: {
      executor: 'ramping-vus',
      exec: 'metricsScenario',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '1m', target: 0 },
      ],
    },
  },
};

export function depositScenario() {
  const url = `${BASE_URL}/api/v1/vault/deposits`;
  const payload = JSON.stringify({
    amount: AMOUNT,
    asset: ASSET,
    walletAddress: WALLET_ADDRESS,
  });
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': buildIdempotencyKey('deposit'),
      'x-wallet-address': WALLET_ADDRESS,
    },
  };

  const res = http.post(url, payload, params);
  check(res, {
    'deposit status is 201': (r) => r.status === 201,
  });
  sleep(1);
}

export function withdrawalScenario() {
  const url = `${BASE_URL}/api/v1/vault/withdrawals`;
  const payload = JSON.stringify({
    amount: AMOUNT,
    asset: ASSET,
    walletAddress: WALLET_ADDRESS,
  });
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': buildIdempotencyKey('withdrawal'),
      'x-wallet-address': WALLET_ADDRESS,
    },
  };

  const res = http.post(url, payload, params);
  check(res, {
    'withdrawal status is 201': (r) => r.status === 201,
  });
  sleep(1);
}

export function metricsScenario() {
  const url = `${BASE_URL}${METRICS_PATH}`;
  const res = http.get(url);
  check(res, {
    'metrics status is 200': (r) => r.status === 200,
  });
  sleep(1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const errorRate = data.metrics.http_req_failed.values.rate;
  const p95Ms = Number.isFinite(p95) ? p95.toFixed(2) : 'n/a';
  const errorPct = Number.isFinite(errorRate) ? (errorRate * 100).toFixed(3) : 'n/a';
  let requestCount = 0;
  if (data.metrics.http_reqs && data.metrics.http_reqs.values) {
    const countValue = data.metrics.http_reqs.values.count;
    if (typeof countValue === 'number') {
      requestCount = countValue;
    }
  }

  const summary = `\nLoad test summary\nP95 latency: ${p95Ms} ms\nError rate: ${errorPct}%\nRequests: ${requestCount}\n`;

  const markdown = `# Load Test Summary\n\n- P95 latency: ${p95Ms} ms (threshold < 500 ms)\n- Error rate: ${errorPct}% (threshold < 0.1%)\n- Total requests: ${requestCount}\n`;

  return {
    stdout: summary,
    'summary.md': markdown,
  };
}
