/**
 * Tests for diagnostics bundle endpoint (Issue #721).
 */

import { Request, Response } from 'express';
import { diagnosticsBundleHandler } from '../diagnosticsBundle';

// Mock dependencies
jest.mock('../circuitBreaker', () => ({
  sorobanCircuitBreaker: {
    toHealthSnapshot: () => ({ state: 'CLOSED', failures: 0, retryAfterMs: 0 }),
  },
}));

jest.mock('../database', () => ({
  db: {
    getHealth: jest.fn().mockResolvedValue({ primary: 'up', replica: 'up' }),
  },
}));

jest.mock('../prisma', () => ({
  getPrismaRuntimeConfig: () => ({
    poolMax: 10,
    poolTimeoutMs: 10000,
    queryTimeoutMs: 5000,
  }),
}));

jest.mock('../jobGovernance', () => ({
  getJobHealthStatus: () => 'healthy',
  getJobMetrics: () => ({ totalRuns: 42, failures: 0 }),
}));

jest.mock('../tracing', () => ({
  getCurrentTraceId: () => 'test-trace-id',
}));

jest.mock('../middleware/structuredLogging', () => ({
  logger: { log: jest.fn(), configure: jest.fn() },
}));

function mockReq(): Request {
  return {
    get: jest.fn(() => 'test-admin'),
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: any } {
  const res = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res as any;
}

describe('diagnosticsBundleHandler', () => {
  it('returns a diagnostics bundle with expected structure', async () => {
    const req = mockReq();
    const res = mockRes();

    await diagnosticsBundleHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('generatedAt');
    expect(res.body).toHaveProperty('traceId', 'test-trace-id');
    expect(res.body).toHaveProperty('runtime');
    expect(res.body).toHaveProperty('config');
    expect(res.body).toHaveProperty('dependencies');
  });

  it('includes runtime info with memory and uptime', async () => {
    const req = mockReq();
    const res = mockRes();

    await diagnosticsBundleHandler(req, res);

    const runtime = res.body.runtime;
    expect(runtime).toHaveProperty('nodeVersion');
    expect(runtime).toHaveProperty('platform');
    expect(runtime).toHaveProperty('uptime');
    expect(runtime).toHaveProperty('memory');
    expect(runtime.memory).toHaveProperty('rssMb');
    expect(runtime.memory).toHaveProperty('heapUsedMb');
  });

  it('includes dependency health', async () => {
    const req = mockReq();
    const res = mockRes();

    await diagnosticsBundleHandler(req, res);

    const deps = res.body.dependencies;
    expect(deps).toHaveProperty('database');
    expect(deps.database.primary).toBe('up');
    expect(deps).toHaveProperty('stellarRpc');
    expect(deps.stellarRpc).toHaveProperty('circuitBreaker');
    expect(deps).toHaveProperty('jobs');
  });

  it('redacts sensitive environment variables and fully masks secrets without partial disclosure', async () => {
    // Set sensitive env vars to test redaction
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'super-secret-jwt-token-key-12345';
    process.env.RATE_LIMIT_REDIS_URL = 'redis://user:secretpassword123@localhost:6379';
    process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD = '5';

    const req = mockReq();
    const res = mockRes();

    await diagnosticsBundleHandler(req, res);

    const config = res.body.config;
    expect(config.NODE_ENV).toBe('test');
    // JWT_SECRET should never appear in diagnostics bundle
    expect(config).not.toHaveProperty('JWT_SECRET');
    // Sensitive keys under allowed prefixes must be fully masked
    if (config.RATE_LIMIT_REDIS_URL) {
      expect(config.RATE_LIMIT_REDIS_URL).toBe('***REDACTED***');
      expect(config.RATE_LIMIT_REDIS_URL).not.toContain('secretpassword');
    }
    // Non-allowed keys should not appear
    expect(config).not.toHaveProperty('HOME');
    expect(config).not.toHaveProperty('PATH');
  });
});
