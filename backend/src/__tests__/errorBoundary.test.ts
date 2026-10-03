/**
 * Tests for typed error boundary middleware (Issue #708).
 */

import { Request, Response, NextFunction } from 'express';
import { errorBoundaryMiddleware, UpstreamError, DatabaseError, RedisError, RpcError } from '../middleware/errorBoundary';
import { CircuitOpenError } from '../circuitBreaker';
import { SorobanSimulationError } from '../sorobanClient';

function mockReq(): Request {
  return {
    headers: {},
    correlationId: 'test-corr-id',
    get: jest.fn(() => undefined),
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: any; headersSent: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: null as any,
    headersSent: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headersSent[key] = value;
      return res;
    },
  };
  return res as any;
}

describe('errorBoundaryMiddleware', () => {
  it('handles DatabaseError with retry hint', () => {
    const err = new DatabaseError('Connection lost');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('DATABASE_ERROR');
    expect(res.body.retryable).toBe(true);
    expect(res.body.retryAfterSeconds).toBe(5);
    expect(res.headersSent['Retry-After']).toBe('5');
    expect(next).not.toHaveBeenCalled();
  });

  it('handles RedisError with retry hint', () => {
    const err = new RedisError('Redis timeout');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CACHE_ERROR');
    expect(res.body.retryable).toBe(true);
    expect(res.body.retryAfterSeconds).toBe(3);
  });

  it('handles RpcError with retry hint', () => {
    const err = new RpcError('Soroban unreachable');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('RPC_ERROR');
    expect(res.body.dependency).toBe('stellar_rpc');
  });

  it('handles CircuitOpenError', () => {
    const err = new CircuitOpenError(15000);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CIRCUIT_OPEN');
    expect(res.body.retryable).toBe(true);
    expect(res.body.retryAfterSeconds).toBe(15);
  });

  it('handles SorobanSimulationError', () => {
    const err = new SorobanSimulationError('Simulation failed', 'SIMULATION_ERROR', 502);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('SIMULATION_ERROR');
    expect(res.body.dependency).toBe('stellar_rpc');
  });

  it('handles Prisma-style errors (P2002)', () => {
    const err = new Error('Unique constraint failed') as any;
    err.code = 'P2002';
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('DATABASE_ERROR');
    expect(res.body.dependency).toBe('database');
  });

  describe('PrismaClientKnownRequestError sanitization', () => {
    class PrismaClientKnownRequestError extends Error {
      constructor(
        message: string,
        public code: string,
        public meta?: Record<string, unknown>,
      ) {
        super(message);
        this.name = 'PrismaClientKnownRequestError';
      }
    }

    const run = (err: Error) => {
      const res = mockRes();
      errorBoundaryMiddleware(err, mockReq(), res, jest.fn());
      return res;
    };

    it('maps duplicate vault creation (P2002) to 409 without leaking SQL or meta', () => {
      const res = run(
        new PrismaClientKnownRequestError(
          'Invalid `prisma.vault.create()` invocation: INSERT INTO "Vault" ("id") VALUES ($1) Unique constraint failed on the fields: (`id`)',
          'P2002',
          { target: ['id'], modelName: 'Vault' },
        ),
      );

      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toBe('Resource already exists');
      expect(res.body.retryable).toBe(false);
      expect(res.body.meta).toBeUndefined();
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('INSERT');
      expect(serialized).not.toContain('Vault');
    });

    it('maps P2003 to 400 INVALID_REFERENCE', () => {
      const res = run(new PrismaClientKnownRequestError('FK failed', 'P2003', { field_name: 'x' }));
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('INVALID_REFERENCE');
      expect(JSON.stringify(res.body)).not.toContain('field_name');
    });

    it('maps P2025 to 404', () => {
      const res = run(new PrismaClientKnownRequestError('No record found', 'P2025'));
      expect(res.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  it('handles Prisma query timeout errors', () => {
    const err = new Error('Prisma query timed out after 5000ms (Transaction.findMany)');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('DATABASE_TIMEOUT');
  });

  it('handles FORBIDDEN_TENANT_ACCESS errors', () => {
    const err = new Error('FORBIDDEN_TENANT_ACCESS');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('WALLET_SCOPE_VIOLATION');
    expect(res.body.retryable).toBe(false);
  });

  it('passes unrecognised errors to next handler', () => {
    const err = new Error('Something completely different');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorBoundaryMiddleware(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeNull();
  });
});

describe('UpstreamError classes', () => {
  it('DatabaseError has correct defaults', () => {
    const err = new DatabaseError('test');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.statusCode).toBe(503);
    expect(err.dependency).toBe('database');
    expect(err.retryable).toBe(true);
  });

  it('RedisError has correct defaults', () => {
    const err = new RedisError('test');
    expect(err.code).toBe('CACHE_ERROR');
    expect(err.statusCode).toBe(503);
    expect(err.dependency).toBe('redis');
  });

  it('RpcError has correct defaults', () => {
    const err = new RpcError('test');
    expect(err.code).toBe('RPC_ERROR');
    expect(err.statusCode).toBe(502);
    expect(err.dependency).toBe('stellar_rpc');
  });

  it('allows custom retry settings', () => {
    const err = new DatabaseError('test', { retryable: false, retryAfterSeconds: 0 });
    expect(err.retryable).toBe(false);
    expect(err.retryAfterSeconds).toBe(0);
  });
});
