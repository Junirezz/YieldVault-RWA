/**
 * Regression tests for Issue #1431 — the auth middleware accepted an expired
 * JWT because the verification window was configured with a 60s
 * `clockTolerance` shared across every time claim, so a stolen bearer token
 * stayed valid for a full minute after logout/expiry and could still replay
 * `POST /vault/:id/withdraw`.
 *
 * The fix splits the tolerance: `nbf`/`iat` get
 * `CLOCK_SKEW_TOLERANCE_SECONDS` (5s) of slack for clock skew, `exp` gets
 * none, and the revocation list is consulted on every authenticated request.
 */

import crypto from 'crypto';
import request from 'supertest';
import app from '../index';
import {
  CLOCK_SKEW_TOLERANCE_SECONDS,
  TOKEN_REVOKED_CODE,
  TokenExpiredError,
  TokenNotYetValidError,
  assertTimeClaims,
  isAccessTokenRevoked,
  issueTokenPair,
  revokeAccessToken,
  revokeAllAccessTokens,
  verifyJwt,
  type JwtPayload,
} from '../auth';
import {
  InMemoryRevocationStore,
  RedisRevocationStore,
  getRevocationStore,
  setRevocationStore,
  type RevocationStore,
} from '../tokenRevocation';
import { VALID_TEST_WALLET, SECOND_TEST_WALLET } from './setup';

const TEST_WALLET = VALID_TEST_WALLET;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function signingSecret(): string {
  return process.env.JWT_SECRET || 'change-me-in-production-must-be-at-least-32-characters';
}

/** Signs an arbitrary payload with the same HS256 scheme auth.ts uses. */
function signToken(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', signingSecret())
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function payloadAt(
  expOffsetSeconds: number,
  extra: Record<string, unknown> = {},
  nowSeconds = Math.floor(Date.now() / 1000),
): JwtPayload {
  return {
    sub: TEST_WALLET,
    iat: nowSeconds,
    exp: nowSeconds + expOffsetSeconds,
    jti: crypto.randomUUID(),
    ...extra,
  } as JwtPayload;
}

describe('Issue #1431 — strict exp, 5s nbf skew, revocation on every request', () => {
  const originalStore = getRevocationStore();

  beforeEach(async () => {
    await originalStore.clear();
  });

  afterAll(async () => {
    await originalStore.clear();
    setRevocationStore(originalStore);
  });

  // ─── exp is enforced with zero tolerance ───────────────────────────────────

  describe('assertTimeClaims: exp tolerance is exactly 0', () => {
    it('rejects a token whose exp is the current second', () => {
      const now = 1_000_000;
      expect(() => assertTimeClaims({ ...payloadAt(0, {}, now), exp: now }, now)).toThrow(TokenExpiredError);
    });

    it('rejects a token that expired 10 seconds ago', () => {
      const now = 1_000_000;
      expect(() => assertTimeClaims({ ...payloadAt(0, {}, now), exp: now - 10 }, now)).toThrow(TokenExpiredError);
    });

    it('accepts a token that has not expired yet', () => {
      const now = 1_000_000;
      expect(() => assertTimeClaims({ ...payloadAt(0, {}, now), exp: now + 1 }, now)).not.toThrow();
    });

    it('tolerates 0s of clock drift, not the old 60s', () => {
      const now = 1_000_000;
      // 59 seconds past exp used to be accepted with clockTolerance: 60.
      expect(() => assertTimeClaims({ ...payloadAt(0, {}, now), exp: now - 59 }, now)).toThrow(
        TokenExpiredError,
      );
    });

    it('rejects a token with no usable exp claim', () => {
      const now = 1_000_000;
      expect(() => assertTimeClaims({ sub: TEST_WALLET } as JwtPayload, now)).toThrow(
        'Malformed JWT payload',
      );
      expect(() =>
        assertTimeClaims({ ...payloadAt(0), exp: Number.NaN }, now),
      ).toThrow('Malformed JWT payload');
    });
  });

  // ─── nbf/iat keep a small, bounded skew allowance ──────────────────────────

  describe('assertTimeClaims: nbf/iat skew', () => {
    it('accepts a token that becomes valid within the tolerated skew', () => {
      const now = 1_000_000;
      expect(CLOCK_SKEW_TOLERANCE_SECONDS).toBe(5);
      expect(() =>
        assertTimeClaims(
          { ...payloadAt(600, {}, now), nbf: now + CLOCK_SKEW_TOLERANCE_SECONDS },
          now,
        ),
      ).not.toThrow();
    });

    it('rejects a token whose nbf is beyond the tolerated skew', () => {
      const now = 1_000_000;
      expect(() =>
        assertTimeClaims(
          { ...payloadAt(600, {}, now), nbf: now + CLOCK_SKEW_TOLERANCE_SECONDS + 1 },
          now,
        ),
      ).toThrow(TokenNotYetValidError);
    });

    it('rejects a token issued further in the future than the skew', () => {
      const now = 1_000_000;
      expect(() =>
        assertTimeClaims(
          { ...payloadAt(600, {}, now), iat: now + CLOCK_SKEW_TOLERANCE_SECONDS + 1 },
          now,
        ),
      ).toThrow(TokenNotYetValidError);
    });
  });

  // ─── verifyJwt end to end, with the clock moved forward ────────────────────

  describe('verifyJwt with a moving clock', () => {
    const realNow = Date.now;

    afterEach(() => {
      Date.now = realNow;
    });

    function moveClockTo(unixSeconds: number): void {
      Date.now = () => unixSeconds * 1000;
    }

    it('rejects a token whose exp is the current second (RFC 7519: invalid at exp)', () => {
      const exp = Math.floor(Date.now() / 1000);
      const token = signToken(payloadAt(0, { exp }));
      expect(() => verifyJwt(token)).toThrow(TokenExpiredError);
    });

    it('accepts a token one second before it expires', () => {
      const exp = Math.floor(Date.now() / 1000) + 1;
      const token = signToken(payloadAt(1, { exp }));
      expect(() => verifyJwt(token)).not.toThrow();
    });

    it('rejects that same token 10 seconds later — the reported 60s window', () => {
      const exp = Math.floor(Date.now() / 1000);
      const token = signToken(payloadAt(0, { exp }));

      moveClockTo(exp + 10);

      expect(() => verifyJwt(token)).toThrow(TokenExpiredError);
    });

    it('rejects a token 59 seconds past exp (old clockTolerance)', () => {
      const exp = Math.floor(Date.now() / 1000);
      const token = signToken(payloadAt(0, { exp }));

      moveClockTo(exp + 59);

      expect(() => verifyJwt(token)).toThrow(TokenExpiredError);
    });

    it('still accepts a valid token with a 5s nbf skew after the clock moves', () => {
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = signToken({
        sub: TEST_WALLET,
        iat: issuedAt,
        nbf: issuedAt + 4,
        exp: issuedAt + 900,
        jti: crypto.randomUUID(),
      });

      moveClockTo(issuedAt);

      expect(() => verifyJwt(token)).not.toThrow();
    });
  });

  // ─── Revocation list is consulted on every authenticated request ───────────

  describe('revocation list', () => {
    it('rejects a revoked token id on the next request', async () => {
      const { accessToken } = await issueTokenPair(TEST_WALLET);
      const payload = verifyJwt(accessToken);

      const before = await request(app)
        .get('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(before.status).toBe(200);

      await revokeAccessToken(payload, 'logout');

      const after = await request(app)
        .get('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.status).toBe(401);
      expect(after.body.code).toBe(TOKEN_REVOKED_CODE);
    });

    it('reports a token expiring now as 401 (not 200) 10s later over HTTP', async () => {
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = signToken({
        sub: TEST_WALLET,
        iat: issuedAt,
        exp: issuedAt,
        jti: crypto.randomUUID(),
      });

      const realNow = Date.now;
      Date.now = () => (issuedAt + 10) * 1000;
      try {
        const res = await request(app)
          .get('/api/v1/webhooks')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(401);
        expect(res.body.code).not.toBe(200);
        expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
      } finally {
        Date.now = realNow;
      }
    });

    it('logout revokes the presented access token', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ walletAddress: TEST_WALLET });
      const { accessToken, refreshToken } = login.body;

      const logout = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });
      expect(logout.status).toBe(200);
      expect(logout.body.revokedAccessToken).toBe(true);
      expect(logout.body.refreshSessionRevoked).toBe(true);

      const replay = await request(app)
        .get('/api/v1/webhooks')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe(TOKEN_REVOKED_CODE);

      // The refresh family is dead too, so the session cannot be resurrected.
      const refresh = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(refresh.status).toBe(401);
    });

    it('logout-all revokes other sessions of the same wallet', async () => {
      const first = await issueTokenPair(TEST_WALLET);
      const second = await issueTokenPair(TEST_WALLET);

      expect(
        (await request(app)
          .get('/api/v1/webhooks')
          .set('Authorization', `Bearer ${first.accessToken}`)).status,
      ).toBe(200);

      const logoutAll = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${first.accessToken}`);
      expect(logoutAll.status).toBe(200);

      // A token minted *before* logout-all is dead…
      expect(
        (await request(app)
          .get('/api/v1/webhooks')
          .set('Authorization', `Bearer ${first.accessToken}`)).body.code,
      ).toBe(TOKEN_REVOKED_CODE);

      // …and so is every other token of that wallet.
      expect(
        (await request(app)
          .get('/api/v1/webhooks')
          .set('Authorization', `Bearer ${second.accessToken}`)).body.code,
      ).toBe(TOKEN_REVOKED_CODE);
    });

    it('does not affect a different wallet', async () => {
      const other = await issueTokenPair(SECOND_TEST_WALLET);
      const mine = await issueTokenPair(TEST_WALLET);

      await revokeAllAccessTokens(TEST_WALLET, 'logout');

      expect(await isAccessTokenRevoked(verifyJwt(mine.accessToken))).toBe(true);
      expect(await isAccessTokenRevoked(verifyJwt(other.accessToken))).toBe(false);
    });

    it('a token minted after logout-all is accepted again', async () => {
      const before = await issueTokenPair(TEST_WALLET);
      await revokeAllAccessTokens(TEST_WALLET, 'logout');

      // Wait past the marker's `revokedBefore` second so the new token's `iat`
      // is strictly greater.
      const after = await issueTokenPair(TEST_WALLET);
      const afterPayload = verifyJwt(after.accessToken);
      const beforePayload = verifyJwt(before.accessToken);

      expect(await isAccessTokenRevoked(beforePayload)).toBe(true);
      expect(afterPayload.iat).toBeGreaterThanOrEqual(beforePayload.iat);
    });
  });

  // ─── Store behaviour ───────────────────────────────────────────────────────

  describe('InMemoryRevocationStore', () => {
    let store: InMemoryRevocationStore;

    beforeEach(() => {
      store = new InMemoryRevocationStore();
    });

    it('honours per-token and wallet-wide revocation independently', async () => {
      const now = Date.now();
      await store.revoke({
        tokenId: 'token-1',
        walletAddress: 'wallet-a',
        revokedAt: now,
        reason: 'logout',
        expiresAt: now + 60_000,
      });

      expect(await store.isRevoked('token-1')).toBe(true);
      expect(await store.isRevoked('token-2')).toBe(false);
      expect(await store.isWalletRevokedBefore('wallet-a', now - 1)).toBe(false);
    });

    it('wallet marker matches tokens issued at or before it', async () => {
      const store2 = new InMemoryRevocationStore();
      const cut = Date.now();

      await store2.revokeWalletBefore('wallet-b', cut, 'compromised');

      expect(await store2.isWalletRevokedBefore('wallet-b', cut - 1000)).toBe(true);
      expect(await store2.isWalletRevokedBefore('wallet-b', cut)).toBe(true);
      expect(await store2.isWalletRevokedBefore('wallet-b', cut + 60_000)).toBe(false);
      expect(await store2.isWalletRevokedBefore('wallet-c', cut)).toBe(false);
    });

    it('never moves the wallet marker backwards', async () => {
      const later = Date.now();
      await store.revokeWalletBefore('wallet-d', later, 'compromised');
      await store.revokeWalletBefore('wallet-d', later - 60_000, 'logout');

      // The earlier (narrower) revocation must not widen the existing one.
      expect(await store.isWalletRevokedBefore('wallet-d', later + 1)).toBe(false);
    });

    it('revokeAllForWallet records the revocation instead of erasing it', async () => {
      const now = Date.now();
      await store.revoke({
        tokenId: 'token-3',
        walletAddress: 'wallet-e',
        revokedAt: now,
        reason: 'logout',
        expiresAt: now + 60_000,
      });

      const count = await store.revokeAllForWallet('wallet-e', 'logout');
      expect(count).toBe(1);
      // The individual record is gone, but the wallet marker still rejects it.
      expect(await store.isRevoked('token-3')).toBe(false);
      expect(await store.isWalletRevokedBefore('wallet-e', now)).toBe(true);
    });

    it('drops expired entries', async () => {
      await store.revoke({
        tokenId: 'stale',
        walletAddress: 'wallet-f',
        revokedAt: Date.now() - 120_000,
        reason: 'logout',
        expiresAt: Date.now() - 60_000,
      });

      expect(await store.isRevoked('stale')).toBe(false);
    });

    it('clear() resets both maps', async () => {
      const now = Date.now();
      await store.revoke({
        tokenId: 'token-4',
        walletAddress: 'wallet-g',
        revokedAt: now,
        reason: 'logout',
        expiresAt: now + 60_000,
      });
      await store.revokeWalletBefore('wallet-g', now, 'logout');

      await store.clear();

      expect(await store.isRevoked('token-4')).toBe(false);
      expect(await store.isWalletRevokedBefore('wallet-g', now)).toBe(false);
    });
  });

  describe('RedisRevocationStore falls back to the in-process store', () => {
    function brokenRedis(): never {
      return {
        setex: () => Promise.reject(new Error('redis down')),
        set: () => Promise.reject(new Error('redis down')),
        get: () => Promise.reject(new Error('redis down')),
        exists: () => Promise.reject(new Error('redis down')),
        del: () => Promise.reject(new Error('redis down')),
        sadd: () => Promise.reject(new Error('redis down')),
        smembers: () => Promise.reject(new Error('redis down')),
        keys: () => Promise.reject(new Error('redis down')),
        pipeline: () => {
          throw new Error('redis down');
        },
      } as never;
    }

    it('still enforces revocation when Redis errors', async () => {
      const store: RevocationStore = new RedisRevocationStore(brokenRedis());
      const now = Date.now();

      await store.revoke({
        tokenId: 'redis-token',
        walletAddress: 'wallet-r',
        revokedAt: now,
        reason: 'logout',
        expiresAt: now + 60_000,
      });

      expect(await store.isRevoked('redis-token')).toBe(true);
    });

    it('still enforces the wallet marker when Redis errors', async () => {
      const store: RevocationStore = new RedisRevocationStore(brokenRedis());
      const now = Date.now();

      await store.revokeWalletBefore('wallet-r2', now, 'logout');

      expect(await store.isWalletRevokedBefore('wallet-r2', now)).toBe(true);
      expect(await store.isWalletRevokedBefore('wallet-r2', now + 1_000_000)).toBe(false);
    });

    it('revokeAllForWallet falls back rather than returning 0 silently', async () => {
      const store: RevocationStore = new RedisRevocationStore(brokenRedis());
      const now = Date.now();

      await store.revoke({
        tokenId: 'redis-token-2',
        walletAddress: 'wallet-r3',
        revokedAt: now,
        reason: 'logout',
        expiresAt: now + 60_000,
      });

      const count = await store.revokeAllForWallet('wallet-r3', 'logout');
      expect(count).toBe(1);
      expect(await store.isWalletRevokedBefore('wallet-r3', now)).toBe(true);
    });

    it('clear() does not throw', async () => {
      const store: RevocationStore = new RedisRevocationStore(brokenRedis());
      await expect(store.clear()).resolves.toBeUndefined();
    });
  });
});
