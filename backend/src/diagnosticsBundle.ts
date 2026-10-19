/**
 * @file diagnosticsBundle.ts
 * On-demand diagnostics bundle endpoint for incident triage.
 *
 * Generates a sanitized diagnostics bundle containing runtime configuration
 * and dependency health status.  Sensitive values (secrets, keys, tokens)
 * are redacted automatically.
 *
 * Issue #721
 */

import type { Request, Response } from 'express';
import { sorobanCircuitBreaker } from './circuitBreaker';
import { db } from './database';
import { getPrismaRuntimeConfig } from './prisma';
import { getJobHealthStatus, getJobMetrics } from './jobGovernance';
import {
  getLastAutomatedReconciliationSummary,
  getLastAutomatedReconciliationRunAt,
} from './reconciliationReport';
import { logger } from './middleware/structuredLogging';
import { getCurrentTraceId } from './tracing';

// ─── Redaction ──────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /secret/i,
  /password/i,
  /token/i,
  /api_key/i,
  /apikey/i,
  /private/i,
  /credential/i,
  /auth/i,
  /jwt/i,
  /signing/i,
  /database_url/i,
  /redis_url/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function redactValue(key: string, value: string): string {
  if (!isSensitiveKey(key)) return value;
  return '***REDACTED***';
}

function getSanitizedEnvConfig(): Record<string, string> {
  const allowedPrefixes = [
    'NODE_ENV',
    'PORT',
    'LOG_LEVEL',
    'STELLAR_NETWORK',
    'STELLAR_HORIZON_URL',
    'STELLAR_RPC_URL',
    'VAULT_CONTRACT_ID',
    'CIRCUIT_BREAKER_',
    'CACHE_',
    'PRISMA_POOL_',
    'PRISMA_QUERY_',
    'DRAIN_TIMEOUT_MS',
    'OTEL_',
    'RATE_LIMIT_',
    'MAINTENANCE_',
    'FEATURE_FLAG_',
    'CALAGENT_',
  ];

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const matches = allowedPrefixes.some(
      (prefix) => key === prefix || key.startsWith(prefix),
    );
    if (!matches) continue;
    result[key] = redactValue(key, value);
  }

  return result;
}

// ─── Dependency Status ──────────────────────────────────────────────────────

async function getDependencyStatus(): Promise<Record<string, unknown>> {
  const dbHealth = await db.getHealth().catch(() => ({ primary: 'error', replica: 'error' }));
  const circuitSnapshot = sorobanCircuitBreaker.toHealthSnapshot();

  return {
    database: {
      primary: dbHealth.primary,
      replica: dbHealth.replica,
      prisma: getPrismaRuntimeConfig(),
    },
    stellarRpc: {
      circuitBreaker: circuitSnapshot,
      rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
      network: process.env.STELLAR_NETWORK || 'testnet',
    },
    jobs: {
      health: getJobHealthStatus(),
      metrics: getJobMetrics(),
    },
  };
}

// ─── Runtime Info ───────────────────────────────────────────────────────────

function getRuntimeInfo(): Record<string, unknown> {
  const mem = process.memoryUsage();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    },
    cpuUsage: process.cpuUsage(),
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/diagnostics
 *
 * Returns a sanitized diagnostics bundle for incident response.
 * Requires admin API key with ADMIN_READ permission.
 */
export async function diagnosticsBundleHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const traceId = getCurrentTraceId();

  logger.log('info', 'Diagnostics bundle requested', {
    traceId,
    requestedBy: req.get('x-admin-address') || 'unknown',
  });

  const [dependencyStatus] = await Promise.all([getDependencyStatus()]);

  const bundle = {
    generatedAt: new Date().toISOString(),
    traceId,
    runtime: getRuntimeInfo(),
    config: getSanitizedEnvConfig(),
    dependencies: dependencyStatus,
    lastReconciliation: getLastAutomatedReconciliationSummary()
      ? {
          summary: getLastAutomatedReconciliationSummary(),
          lastRunAt: getLastAutomatedReconciliationRunAt(),
        }
      : null,
  };

  res.status(200).json(bundle);
}
