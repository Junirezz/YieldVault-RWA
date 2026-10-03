import express, { Request, Response } from 'express';
import request from 'supertest';
import { createLimiter, extractRateLimitKey, resolveClientIp } from '../rateLimiter';

function fakeReq(opts: {
  trustProxy?: unknown;
  ip?: string;
  remoteAddress?: string;
}): Request {
  return {
    headers: {},
    ip: opts.ip,
    socket: { remoteAddress: opts.remoteAddress },
    app: { get: (k: string) => (k === 'trust proxy' ? opts.trustProxy : undefined) },
  } as unknown as Request;
}

describe('rate limiter client IP resolution', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('assigns the same bucket key to different X-Forwarded-For values from one socket', () => {
    const a = fakeReq({ ip: '1.1.1.1', remoteAddress: '10.0.0.5' });
    const b = fakeReq({ ip: '2.2.2.2', remoteAddress: '10.0.0.5' });
    expect(extractRateLimitKey(a)).toBe('10.0.0.5');
    expect(extractRateLimitKey(b)).toBe('10.0.0.5');
  });

  it('uses req.ip when trust proxy is enabled', () => {
    const req = fakeReq({ trustProxy: true, ip: '1.1.1.1', remoteAddress: '10.0.0.5' });
    expect(resolveClientIp(req)).toBe('1.1.1.1');
  });

  it('warns once per app when trust proxy is unset', () => {
    const req = fakeReq({ ip: '1.1.1.1', remoteAddress: '10.0.0.5' });
    resolveClientIp(req);
    resolveClientIp(req);
    const warns = logSpy.mock.calls.filter(([m]) => String(m).includes('rate_limit_trust_proxy_unset'));
    expect(warns).toHaveLength(1);
  });

  it('does not warn when trust proxy is explicitly set', () => {
    resolveClientIp(fakeReq({ trustProxy: false, remoteAddress: '10.0.0.5' }));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('cannot be bypassed by rotating X-Forwarded-For (no trust proxy)', async () => {
    const app = express();
    app.get('/t', createLimiter({ tier: 'xff-test', max: 1, windowMs: 60000 }), (_q: Request, r: Response) => {
      r.json({ ok: true });
    });

    const first = await request(app).get('/t').set('X-Forwarded-For', '1.1.1.1');
    const second = await request(app).get('/t').set('X-Forwarded-For', '2.2.2.2');
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('works for plain local dev requests without proxy headers', async () => {
    const app = express();
    app.get('/t', createLimiter({ tier: 'dev-test', max: 2, windowMs: 60000 }), (_q: Request, r: Response) => {
      r.json({ ok: true });
    });

    expect((await request(app).get('/t')).status).toBe(200);
    expect((await request(app).get('/t')).status).toBe(200);
    expect((await request(app).get('/t')).status).toBe(429);
  });
});
