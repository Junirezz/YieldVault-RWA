jest.mock('../tracing', () => ({ getCurrentTraceId: jest.fn(() => undefined) }));

import type { Request, Response } from 'express';
import {
  apiErrorContractMiddleware,
  buildApiErrorBody,
  sendApiError,
  statusLabel,
} from '../middleware/apiError';

function mockRes(statusCode = 200) {
  const res: any = { statusCode, headers: {} as Record<string, string> };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn((k: string, v: string) => {
    res.headers[k] = v;
  });
  return res as Response & { body: any; headers: Record<string, string> };
}

describe('apiError', () => {
  describe('statusLabel', () => {
    it('maps known statuses and falls back for unknown ones', () => {
      expect(statusLabel(401)).toBe('Unauthorized');
      expect(statusLabel(503)).toBe('Service Unavailable');
      expect(statusLabel(418)).toBe('Request Error');
    });
  });

  describe('buildApiErrorBody', () => {
    it('applies status-derived defaults', () => {
      expect(buildApiErrorBody({ status: 404, message: 'nope' })).toEqual({
        error: 'Not Found',
        status: 404,
        code: 'ROUTE_NOT_FOUND',
        message: 'nope',
        retryable: false,
      });
    });

    it('marks 5xx as retryable and keeps optional fields only when set', () => {
      const body = buildApiErrorBody({ status: 500, message: 'boom', details: { a: 1 } });
      expect(body.retryable).toBe(true);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.details).toEqual({ a: 1 });
      expect('correlationId' in body).toBe(false);
    });
  });

  describe('sendApiError', () => {
    it('sets Retry-After and writes the canonical body', () => {
      const res = mockRes();
      sendApiError({} as Request, res, {
        status: 429,
        code: 'RATE_LIMITED',
        message: 'slow down',
        retryAfterSeconds: 7,
      });
      expect(res.headers['Retry-After']).toBe('7');
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryable: false });
    });
  });

  describe('apiErrorContractMiddleware', () => {
    it('normalizes hand-rolled error bodies', () => {
      const res = mockRes(401);
      const next = jest.fn();
      const originalJson = res.json as jest.Mock;
      apiErrorContractMiddleware({} as Request, res, next);
      expect(next).toHaveBeenCalled();

      res.json({ error: 'Unauthorized', message: 'no key' });
      expect(originalJson).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401, code: 'AUTH_REQUIRED', message: 'no key' }),
      );
    });

    it('passes success bodies through untouched', () => {
      const res = mockRes(200);
      const originalJson = res.json as jest.Mock;
      apiErrorContractMiddleware({} as Request, res, jest.fn());
      res.json({ ok: true });
      expect(originalJson).toHaveBeenCalledWith({ ok: true });
    });
  });
});
