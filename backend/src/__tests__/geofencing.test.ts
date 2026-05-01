/**
 * Tests for IP-based geofencing middleware (Issue #379).
 */

import request from 'supertest';
import app from '../index';
import {
  geofencingMiddleware,
  loadBlocklist,
  extractClientIp,
  setGeoIpProvider,
  resetGeoIpProvider,
  GeoIpProvider,
} from '../middleware/geofencing';
import type { Request, Response, NextFunction } from 'express';

// ─── Mock GeoIP provider ─────────────────────────────────────────────────────

class MockGeoIpProvider implements GeoIpProvider {
  private map: Record<string, string>;
  constructor(map: Record<string, string>) {
    this.map = map;
  }
  lookup(ip: string): string | null {
    return this.map[ip] ?? null;
  }
}

// ─── loadBlocklist() unit tests ──────────────────────────────────────────────

describe('loadBlocklist()', () => {
  afterEach(() => {
    delete process.env.GEOIP_BLOCKED_COUNTRIES;
  });

  it('returns empty set when env var is not set', () => {
    expect(loadBlocklist().size).toBe(0);
  });

  it('parses comma-separated country codes', () => {
    process.env.GEOIP_BLOCKED_COUNTRIES = 'US,CN,RU';
    const bl = loadBlocklist();
    expect(bl.has('US')).toBe(true);
    expect(bl.has('CN')).toBe(true);
    expect(bl.has('RU')).toBe(true);
  });

  it('normalises codes to upper-case', () => {
    process.env.GEOIP_BLOCKED_COUNTRIES = 'us,cn';
    const bl = loadBlocklist();
    expect(bl.has('US')).toBe(true);
    expect(bl.has('CN')).toBe(true);
  });

  it('filters out invalid codes (not 2 chars)', () => {
    process.env.GEOIP_BLOCKED_COUNTRIES = 'US,INVALID,X,';
    const bl = loadBlocklist();
    expect(bl.has('US')).toBe(true);
    expect(bl.size).toBe(1); // only US
  });
});

// ─── extractClientIp() unit tests ────────────────────────────────────────────

describe('extractClientIp()', () => {
  function makeReq(overrides: Partial<Request> = {}): Request {
    return {
      headers: {},
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
      ...overrides,
    } as unknown as Request;
  }

  it('returns req.ip when no X-Forwarded-For header', () => {
    expect(extractClientIp(makeReq())).toBe('1.2.3.4');
  });

  it('returns the first IP from X-Forwarded-For', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '9.9.9.9, 10.10.10.10' } });
    expect(extractClientIp(req)).toBe('9.9.9.9');
  });

  it('trims whitespace from forwarded IP', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '  5.6.7.8  ' } });
    expect(extractClientIp(req)).toBe('5.6.7.8');
  });
});

// ─── geofencingMiddleware unit tests ─────────────────────────────────────────

function makeMiddlewareTest(
  ip: string,
  countryMap: Record<string, string>,
  blocklist: string,
  geoipEnabled: string = 'true',
): Promise<number> {
  setGeoIpProvider(new MockGeoIpProvider(countryMap));
  process.env.GEOIP_BLOCKED_COUNTRIES = blocklist;
  process.env.GEOIP_ENABLED = geoipEnabled;

  const req = {
    headers: { 'x-forwarded-for': ip },
    ip,
    socket: { remoteAddress: ip },
    path: '/test',
  } as unknown as Request;

  let statusCode = 200;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: () => res,
  } as unknown as Response;

  return new Promise((resolve) => {
    const next: NextFunction = () => resolve(statusCode);
    geofencingMiddleware(req, res, next);
    // If 451 was sent, next() wasn't called
    setTimeout(() => resolve(statusCode), 50);
  });
}

describe('geofencingMiddleware – unit', () => {
  afterEach(() => {
    resetGeoIpProvider();
    delete process.env.GEOIP_BLOCKED_COUNTRIES;
    delete process.env.GEOIP_ENABLED;
  });

  it('blocks a request from a restricted country with 451', async () => {
    const code = await makeMiddlewareTest('1.2.3.4', { '1.2.3.4': 'US' }, 'US');
    expect(code).toBe(451);
  });

  it('allows a request from an unrestricted country', async () => {
    const code = await makeMiddlewareTest('5.6.7.8', { '5.6.7.8': 'DE' }, 'US,CN');
    expect(code).toBe(200);
  });

  it('allows through when GEOIP_ENABLED=false', async () => {
    const code = await makeMiddlewareTest('1.2.3.4', { '1.2.3.4': 'US' }, 'US', 'false');
    expect(code).toBe(200);
  });

  it('allows through when IP cannot be resolved', async () => {
    const code = await makeMiddlewareTest('192.168.1.1', {}, 'US,CN');
    expect(code).toBe(200);
  });

  it('allows through when blocklist is empty', async () => {
    const code = await makeMiddlewareTest('1.2.3.4', { '1.2.3.4': 'US' }, '');
    expect(code).toBe(200);
  });
});

// ─── HTTP integration tests ───────────────────────────────────────────────────

describe('Geofencing – integration (GEOIP_COUNTRY_MAP)', () => {
  const BLOCKED_IP = '203.0.113.1'; // TEST-NET IP from RFC 5737
  const ALLOWED_IP = '198.51.100.2'; // TEST-NET IP from RFC 5737

  beforeAll(() => {
    process.env.GEOIP_ENABLED = 'true';
    process.env.GEOIP_BLOCKED_COUNTRIES = 'XX';
    process.env.GEOIP_COUNTRY_MAP = JSON.stringify({
      [BLOCKED_IP]: 'XX',
      [ALLOWED_IP]: 'DE',
    });
    resetGeoIpProvider(); // reload EnvGeoIpProvider with new map
  });

  afterAll(() => {
    delete process.env.GEOIP_ENABLED;
    delete process.env.GEOIP_BLOCKED_COUNTRIES;
    delete process.env.GEOIP_COUNTRY_MAP;
    resetGeoIpProvider();
  });

  it('returns 451 for a request from a blocked country', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Forwarded-For', BLOCKED_IP);
    expect(res.status).toBe(451);
    expect(res.body.error).toBe('Unavailable For Legal Reasons');
    expect(res.body.country).toBe('XX');
    expect(typeof res.body.message).toBe('string');
  });

  it('returns 200 for a request from an allowed country', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Forwarded-For', ALLOWED_IP);
    expect(res.status).toBe(200);
  });

  it('blocklist change takes effect without restart (re-read on each request)', async () => {
    // Temporarily unblock XX
    process.env.GEOIP_BLOCKED_COUNTRIES = 'ZZ'; // different code
    const res = await request(app)
      .get('/health')
      .set('X-Forwarded-For', BLOCKED_IP);
    // XX is no longer blocked → 200
    expect(res.status).toBe(200);
    // Restore
    process.env.GEOIP_BLOCKED_COUNTRIES = 'XX';
  });

  it('returns 200 when GEOIP_ENABLED is false', async () => {
    process.env.GEOIP_ENABLED = 'false';
    const res = await request(app)
      .get('/health')
      .set('X-Forwarded-For', BLOCKED_IP);
    expect(res.status).toBe(200);
    process.env.GEOIP_ENABLED = 'true';
  });
});
