/** Endpoint traffic class for SLO budgeting. */
export enum EndpointType {
  READ = 'read',
  WRITE = 'write',
}

/** Availability target expressed as a decimal (0.999 = 99.9%). */
export type AvailabilityTarget = number;

export type SlaTier = 'critical' | 'standard' | 'best_effort';

export interface EndpointSlaAnnotation {
  /** Normalized route pattern (dynamic segments as :param). */
  path: string;
  methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  type: EndpointType;
  /** P95 latency budget in milliseconds. */
  p95BudgetMs: number;
  /** P99 latency budget in milliseconds. */
  p99BudgetMs: number;
  /** Documented availability SLO (e.g. 0.999). */
  availabilityTarget: AvailabilityTarget;
  tier: SlaTier;
  /** Human-readable owner team for alert routing. */
  ownerTeam: string;
  description: string;
}

/**
 * Canonical registry of backend endpoint SLA metadata.
 * Drives latency monitoring thresholds and alert mapping.
 */
export const ENDPOINT_SLA_REGISTRY: readonly EndpointSlaAnnotation[] = [
  {
    path: '/health',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 50,
    p99BudgetMs: 150,
    availabilityTarget: 0.999,
    tier: 'critical',
    ownerTeam: 'platform',
    description: 'Liveness probe for load balancers',
  },
  {
    path: '/ready',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 100,
    p99BudgetMs: 250,
    availabilityTarget: 0.999,
    tier: 'critical',
    ownerTeam: 'platform',
    description: 'Readiness probe including dependency checks',
  },
  {
    path: '/metrics',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 200,
    p99BudgetMs: 500,
    availabilityTarget: 0.99,
    tier: 'standard',
    ownerTeam: 'platform',
    description: 'Prometheus metrics scrape endpoint',
  },
  {
    path: '/api/v1/vault/summary',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 200,
    p99BudgetMs: 500,
    availabilityTarget: 0.995,
    tier: 'critical',
    ownerTeam: 'backend',
    description: 'Vault summary for dashboard',
  },
  {
    path: '/api/v1/vault/metrics',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 200,
    p99BudgetMs: 500,
    availabilityTarget: 0.995,
    tier: 'standard',
    ownerTeam: 'backend',
    description: 'Vault performance metrics',
  },
  {
    path: '/api/v1/vault/apy',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 200,
    p99BudgetMs: 500,
    availabilityTarget: 0.995,
    tier: 'standard',
    ownerTeam: 'backend',
    description: 'Current vault APY',
  },
  {
    path: '/api/v1/vault/:id',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 200,
    p99BudgetMs: 500,
    availabilityTarget: 0.995,
    tier: 'standard',
    ownerTeam: 'backend',
    description: 'Single vault detail',
  },
  {
    path: '/api/v1/vault/deposit',
    methods: ['POST'],
    type: EndpointType.WRITE,
    p95BudgetMs: 500,
    p99BudgetMs: 1200,
    availabilityTarget: 0.99,
    tier: 'critical',
    ownerTeam: 'backend',
    description: 'User deposit submission',
  },
  {
    path: '/api/v1/vault/withdraw',
    methods: ['POST'],
    type: EndpointType.WRITE,
    p95BudgetMs: 500,
    p99BudgetMs: 1200,
    availabilityTarget: 0.99,
    tier: 'critical',
    ownerTeam: 'backend',
    description: 'User withdrawal submission',
  },
  {
    path: '/admin/cache/invalidate',
    methods: ['POST'],
    type: EndpointType.WRITE,
    p95BudgetMs: 500,
    p99BudgetMs: 1200,
    availabilityTarget: 0.99,
    tier: 'standard',
    ownerTeam: 'platform',
    description: 'Operator cache invalidation',
  },
  {
    path: '/admin/latency-status',
    methods: ['GET'],
    type: EndpointType.READ,
    p95BudgetMs: 200,
    p99BudgetMs: 500,
    availabilityTarget: 0.99,
    tier: 'standard',
    ownerTeam: 'platform',
    description: 'Latency SLO status for operators',
  },
] as const;

const registryByPath = new Map<string, EndpointSlaAnnotation>(
  ENDPOINT_SLA_REGISTRY.map((entry) => [entry.path, entry]),
);

/** Lookup SLA annotation for a normalized endpoint path. */
export function getEndpointSla(path: string): EndpointSlaAnnotation | undefined {
  return registryByPath.get(path);
}

/** P95 budget for monitoring; falls back to read/write defaults from env-driven SLO config. */
export function resolveLatencyBudgetMs(
  path: string,
  fallbackReadMs: number,
  fallbackWriteMs: number,
): number {
  const entry = getEndpointSla(path);
  if (entry) {
    return entry.p95BudgetMs;
  }
  const guessedWrite = path.includes('/admin/') || path.includes('deposit') || path.includes('withdraw');
  return guessedWrite ? fallbackWriteMs : fallbackReadMs;
}

export function listEndpointSlaRegistry(): EndpointSlaAnnotation[] {
  return [...ENDPOINT_SLA_REGISTRY];
}
