/**
 * Response-shape contract tests for endpoints that are also reachable through
 * an in-process snapshot builder.
 *
 * `GET /admin/impersonate/:wallet` does not proxy the HTTP route — it
 * re-synthesizes each sub-response (summary, transactions, holdings, history,
 * referral stats, referral code) in-process so an admin sees exactly what the
 * wallet owner sees. That makes every one of those builders a second
 * implementation of a wire contract, and nothing but a test stops the two from
 * drifting.
 *
 * These tests therefore assert each endpoint's shape on *both* paths: the real
 * HTTP response, and the proxied snapshot, for the success and error cases
 * alike. Any builder that hand-rolls a partial body fails here.
 *
 * The referral routes also sit behind a response cache, so every test clears it
 * first: a 200 recorded by an earlier case would be replayed instead of
 * re-running the handler and would quietly mask the failure-path cases.
 *
 * Issues: #1319 (in-process snapshots must mirror the HTTP error envelope),
 * #1322 (validate direct and proxied shapes for the same endpoint),
 * #1318 (invalid pagination must be clamped, not rejected).
 */

import request from 'supertest';
import app from '../index';
import { getPrismaClient, disconnectPrismaClient } from '../prismaClient';
import { referralService } from '../referralService';
import { normalizeWalletAddress } from '../walletUtils';
import { clearAdminAuditLogsForTests } from '../adminAudit';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { invalidateCache } from '../middleware/cache';
import { THIRD_TEST_WALLET } from './setup';

const getPrisma = () => getPrismaClient();

const SUPER_ADMIN_KEY = 'contract-super-admin-key';
const ADMIN_WALLET = 'GADMIN000000000000000000000000000000000000000000000009';

const REFERRER_WALLET = 'GCONTRACTREFERRER000000000000000000000000000000001';
const REFERRED_WALLET = 'GCONTRACTREFERRED000000000000000000000000000000002';
/** Wallet with no referral activity at all — exercises the 404 envelope. */
const INACTIVE_WALLET = THIRD_TEST_WALLET;

interface ImpersonationSnapshot {
  walletAddress: string;
  transactions: unknown;
  portfolioHoldings: unknown;
  vaultHistory: unknown;
  referralStats: { statusCode: number; body: unknown };
  referralCode: { statusCode: number; body: unknown };
}

/** Assert a body carries the full canonical error envelope, not a partial one. */
function expectCanonicalErrorEnvelope(body: unknown, status: number, context: string): void {
  const envelope = (body ?? {}) as Record<string, unknown>;
  const required = ['error', 'status', 'code', 'message', 'retryable'] as const;
  const missing = required.filter(
    (field) => !Object.prototype.hasOwnProperty.call(envelope, field)
  );

  // Report the missing fields together with the call site so a drifting
  // snapshot builder points straight at the field it dropped.
  expect({ context, missing }).toEqual({ context, missing: [] });
  expect(envelope.status).toBe(status);
  expect(typeof envelope.error).toBe('string');
  expect(typeof envelope.code).toBe('string');
  expect((envelope.code as string).length).toBeGreaterThan(0);
  expect(typeof envelope.message).toBe('string');
  expect(typeof envelope.retryable).toBe('boolean');
}

const LIST_ENVELOPE_KEYS = ['data', 'pagination', 'timestamp'] as const;
const PAGINATION_META_KEYS = [
  'count',
  'limit',
  'total',
  'nextCursor',
  'prevCursor',
  'currentPage',
  'totalPages',
  'hasNextPage',
  'hasPrevPage',
] as const;

/**
 * Assert a list body is a well-formed paginated envelope.
 *
 * The success counterpart of `expectCanonicalErrorEnvelope`: a snapshot builder
 * that emits a partial list body still compares equal to the direct response
 * only if both are broken, so each key set is asserted on its own merits too.
 */
function expectCanonicalListEnvelope(body: unknown, context: string): void {
  const envelope = (body ?? {}) as Record<string, unknown>;
  const missing = LIST_ENVELOPE_KEYS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(envelope, field)
  );

  expect({ context, missing }).toEqual({ context, missing: [] });
  expect(Array.isArray(envelope.data)).toBe(true);

  const pagination = (envelope.pagination ?? {}) as Record<string, unknown>;
  const missingPagination = PAGINATION_META_KEYS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(pagination, field)
  );

  expect({ context: `${context}.pagination`, missing: missingPagination }).toEqual({
    context: `${context}.pagination`,
    missing: [],
  });
  expect(typeof pagination.count).toBe('number');
  expect(typeof pagination.limit).toBe('number');
  expect(typeof pagination.hasNextPage).toBe('boolean');
  expect(typeof pagination.hasPrevPage).toBe('boolean');
}

async function impersonate(wallet: string): Promise<ImpersonationSnapshot> {
  const response = await request(app)
    .get(`/admin/impersonate/${wallet}`)
    .set('Authorization', `ApiKey ${SUPER_ADMIN_KEY}`)
    .set('x-admin-id', ADMIN_WALLET);

  expect(response.status).toBe(200);
  return response.body as ImpersonationSnapshot;
}

describe('Response shape contract: endpoints re-synthesized by /admin/impersonate', () => {
  beforeAll(async () => {
    const prisma = getPrisma();
    await prisma.referral.deleteMany();
    await prisma.referralCode.deleteMany();
    await prisma.sharePriceSnapshot.deleteMany();
    await prisma.transaction.deleteMany();

    // Active referrer: a referral row with firstDepositAt set is what makes
    // getReferralStats() return stats instead of null.
    await referralService.createReferralCode(REFERRER_WALLET, 'CONTRACT1');
    await prisma.referral.create({
      data: {
        referrerAddress: normalizeWalletAddress(REFERRER_WALLET),
        referredAddress: normalizeWalletAddress(REFERRED_WALLET),
        firstDepositAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    const prisma = getPrisma();
    await prisma.referral.deleteMany();
    await prisma.referralCode.deleteMany();
    await disconnectPrismaClient();
  });

  beforeEach(() => {
    clearAdminAuditLogsForTests();
    // The referral routes sit behind a 30s response cache, so a 200 recorded by
    // an earlier test would be replayed instead of re-running the handler —
    // which would silently hide the failure-path cases below.
    invalidateCache();
    registerApiKey(SUPER_ADMIN_KEY, { role: 'super-admin' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('error path (404)', () => {
    it('returns the canonical error envelope over HTTP', async () => {
      const direct = await request(app).get(`/api/v1/referrals/${INACTIVE_WALLET}`);

      expect(direct.status).toBe(404);
      expectCanonicalErrorEnvelope(direct.body, 404, 'direct HTTP 404');
    });

    it('returns the same envelope through the impersonation proxy', async () => {
      const snapshot = await impersonate(INACTIVE_WALLET);

      expect(snapshot.referralStats.statusCode).toBe(404);
      expectCanonicalErrorEnvelope(snapshot.referralStats.body, 404, 'proxied 404');
    });

    it('matches the direct response byte-for-byte on both paths (#1319, #1322)', async () => {
      const direct = await request(app).get(`/api/v1/referrals/${INACTIVE_WALLET}`);
      const snapshot = await impersonate(INACTIVE_WALLET);

      expect(snapshot.referralStats).toEqual({
        statusCode: direct.status,
        body: direct.body,
      });
    });
  });

  describe('success path (200)', () => {
    it('returns the same stats body over HTTP and through the proxy', async () => {
      const direct = await request(app).get(`/api/v1/referrals/${REFERRER_WALLET}`);

      expect(direct.status).toBe(200);
      expect(direct.body).toMatchObject({
        referral_count: expect.any(Number),
        total_reward_earned: expect.any(String),
      });

      const snapshot = await impersonate(REFERRER_WALLET);

      expect(snapshot.referralStats).toEqual({
        statusCode: direct.status,
        body: direct.body,
      });
    });
  });

  describe('sibling endpoint: GET /api/v1/referrals/code/:wallet', () => {
    it('matches the direct response through the proxy', async () => {
      const direct = await request(app).get(`/api/v1/referrals/code/${REFERRER_WALLET}`);

      expect(direct.status).toBe(200);

      const snapshot = await impersonate(REFERRER_WALLET);

      expect(snapshot.referralCode).toEqual({
        statusCode: direct.status,
        body: direct.body,
      });
    });
  });

  describe('failure path (500) — the snapshot must not reject (#1319)', () => {
    it('mirrors the stats 500 envelope on both paths and still returns 200 overall', async () => {
      jest
        .spyOn(referralService, 'getReferralStats')
        .mockRejectedValue(new Error('referral store unavailable'));

      const direct = await request(app).get(`/api/v1/referrals/${REFERRER_WALLET}`);

      expect(direct.status).toBe(500);
      expectCanonicalErrorEnvelope(direct.body, 500, 'direct HTTP 500');

      const snapshot = await impersonate(REFERRER_WALLET);

      // The proxy answers 200 with a per-sub-resource status, so a thrown
      // rejection here would surface as a 500 on the whole impersonation
      // response — and take every other synthesized sub-resource with it.
      expect(snapshot.referralStats).toEqual({
        statusCode: direct.status,
        body: direct.body,
      });
      expectCanonicalListEnvelope(snapshot.transactions, 'proxied transactions');
    });

    it('mirrors the referral-code 500 envelope on both paths', async () => {
      jest
        .spyOn(referralService, 'getOrCreateReferralCode')
        .mockRejectedValue(new Error('referral code store unavailable'));

      const direct = await request(app).get(`/api/v1/referrals/code/${REFERRER_WALLET}`);

      expect(direct.status).toBe(500);
      expectCanonicalErrorEnvelope(direct.body, 500, 'direct HTTP 500 (code)');

      const snapshot = await impersonate(REFERRER_WALLET);

      expect(snapshot.referralCode).toEqual({
        statusCode: direct.status,
        body: direct.body,
      });
    });
  });

  describe('every synthesized impersonation sub-resource (#1322)', () => {
    /** The list endpoints `/admin/impersonate/:wallet` re-synthesizes. */
    const PROXIED_LIST_ENDPOINTS = [
      {
        name: 'transactions',
        path: (wallet: string) => `/api/v1/transactions?walletAddress=${wallet}`,
        snapshotKey: 'transactions' as const,
      },
      {
        name: 'portfolio holdings',
        path: (wallet: string) => `/api/v1/portfolio/holdings?walletAddress=${wallet}`,
        snapshotKey: 'portfolioHoldings' as const,
      },
      {
        name: 'vault history',
        path: (_wallet: string) => '/api/v1/vault/history',
        snapshotKey: 'vaultHistory' as const,
      },
    ];

    it.each(PROXIED_LIST_ENDPOINTS)(
      'GET $name is a well-formed list envelope on both the direct and the proxied path',
      async ({ path, snapshotKey }) => {
        const direct = await request(app).get(path(INACTIVE_WALLET));

        expect(direct.status).toBe(200);
        expectCanonicalListEnvelope(direct.body, `direct ${snapshotKey}`);

        const snapshot = await impersonate(INACTIVE_WALLET);

        expectCanonicalListEnvelope(snapshot[snapshotKey], `proxied ${snapshotKey}`);
      }
    );

    it.each(PROXIED_LIST_ENDPOINTS)(
      'the proxied $name payload matches what the endpoint serves',
      async ({ path, snapshotKey }) => {
        const direct = await request(app).get(path(INACTIVE_WALLET));
        const snapshot = await impersonate(INACTIVE_WALLET);
        const proxied = snapshot[snapshotKey] as { data: unknown; pagination: unknown };

        // Only data and the pagination metadata are compared: every envelope
        // carries a per-call `timestamp`, so whole-body equality would fail for
        // reasons that have nothing to do with the wire contract.
        expect(proxied.data).toEqual(direct.body.data);
        expect(proxied.pagination).toEqual(direct.body.pagination);
      }
    );
  });
});

describe('Pagination contract: invalid page params are clamped, never rejected (#1318)', () => {
  /** Every one of these must resolve to the first page, not a 400. */
  const INVALID_PAGE_VALUES = ['-1', '0', 'abc', '1.5', '-999'];

  it.each(INVALID_PAGE_VALUES)('resolves page=%s to the first page', async (page) => {
    const response = await request(app).get(`/api/v1/transactions?page=${page}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination.currentPage).toBe(1);
  });

  it('resolves an invalid limit to the endpoint default', async () => {
    const response = await request(app).get('/api/v1/transactions?limit=abc');

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBeGreaterThan(0);
  });

  it('clamps a limit above the endpoint maximum instead of rejecting it', async () => {
    const response = await request(app).get('/api/v1/transactions?limit=100000');

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBeLessThanOrEqual(100);
  });

  it('still accepts a valid page unchanged', async () => {
    const response = await request(app).get('/api/v1/transactions?page=1&limit=5');

    expect(response.status).toBe(200);
    expect(response.body.pagination.currentPage).toBe(1);
  });

  /**
   * The other list endpoints share the same contract, so they are held to it
   * here too: each one resolves an unusable `limit` to a valid page size
   * instead of letting a NaN reach the data layer as `take` and 500ing.
   */
  it.each([
    ['/api/v1/transactions', 'pagination.limit'],
    ['/api/v1/portfolio/holdings', 'pagination.limit'],
    ['/api/v1/vault/history', 'pagination.limit'],
  ])('GET %s clamps limit=abc to a usable page size', async (path, limitField) => {
    const response = await request(app).get(`${path}?limit=abc`);

    expect(response.status).toBe(200);

    const value = limitField
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], response.body);

    expect(typeof value).toBe('number');
    expect(value as number).toBeGreaterThan(0);
  });

  it('GET /api/v1/vault/receipts clamps limit=abc instead of 500ing', async () => {
    const response = await request(app).get('/api/v1/vault/receipts?limit=abc');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.receipts)).toBe(true);
  });

  it('GET /api/v1/vault/receipts clamps a limit above the endpoint maximum', async () => {
    const response = await request(app).get('/api/v1/vault/receipts?limit=100000');

    expect(response.status).toBe(200);
    expect(response.body.receipts.length).toBeLessThanOrEqual(100);
  });
});
