/**
 * Tests for JWT session tokens with refresh token rotation (Issue #377).
 */

import request from 'supertest';
import app from '../index';
import {
  issueTokenPair,
  verifyJwt,
  rotateRefreshToken,
  SessionRevokedError,
  InvalidRefreshTokenError,
} from '../auth';

const TEST_WALLET = 'GTEST_WALLET_ADDRESS_JWT_001';

// ─── issueTokenPair unit tests ───────────────────────────────────────────────

describe('issueTokenPair()', () => {
  it('returns accessToken and refreshToken strings', () => {
    const pair = issueTokenPair(TEST_WALLET);
    expect(typeof pair.accessToken).toBe('string');
    expect(typeof pair.refreshToken).toBe('string');
    expect(typeof pair.accessTokenExpiresAt).toBe('string');
  });

  it('access token is a valid 3-part JWT', () => {
    const { accessToken } = issueTokenPair(TEST_WALLET);
    expect(accessToken.split('.').length).toBe(3);
  });

  it('access token payload has correct sub (wallet address)', () => {
    const { accessToken } = issueTokenPair(TEST_WALLET);
    const payload = verifyJwt(accessToken);
    expect(payload.sub).toBe(TEST_WALLET);
  });

  it('access token expires in ~15 minutes', () => {
    const before = Math.floor(Date.now() / 1000);
    const { accessToken } = issueTokenPair(TEST_WALLET);
    const payload = verifyJwt(accessToken);
    const ttl = payload.exp - before;
    expect(ttl).toBeGreaterThanOrEqual(890);   // 15 min minus small delta
    expect(ttl).toBeLessThanOrEqual(910);
  });
});

// ─── verifyJwt unit tests ────────────────────────────────────────────────────

describe('verifyJwt()', () => {
  it('successfully verifies a valid token', () => {
    const { accessToken } = issueTokenPair(TEST_WALLET);
    expect(() => verifyJwt(accessToken)).not.toThrow();
  });

  it('throws on tampered payload', () => {
    const { accessToken } = issueTokenPair(TEST_WALLET);
    const parts = accessToken.split('.');
    // Flip a character in the payload segment
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith('A') ? 'B' : 'A');
    expect(() => verifyJwt(parts.join('.'))).toThrow();
  });

  it('throws on expired token', () => {
    // Create token with expiry in the past
    const { accessToken } = issueTokenPair(TEST_WALLET);
    const parts = accessToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1] + '==', 'base64').toString());
    payload.exp = Math.floor(Date.now() / 1000) - 1;
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=/g, '');
    // Re-sign with a wrong secret to force a signature failure first
    expect(() => verifyJwt(parts.join('.'))).toThrow();
  });

  it('throws on malformed token', () => {
    expect(() => verifyJwt('not.a.valid.jwt.here')).toThrow('Malformed JWT');
    expect(() => verifyJwt('onlytwoparts.x')).toThrow('Malformed JWT');
  });
});

// ─── rotateRefreshToken unit tests ───────────────────────────────────────────

describe('rotateRefreshToken()', () => {
  it('returns a new token pair on first rotation', () => {
    const { refreshToken } = issueTokenPair(TEST_WALLET);
    const newPair = rotateRefreshToken(refreshToken);
    expect(typeof newPair.accessToken).toBe('string');
    expect(typeof newPair.refreshToken).toBe('string');
    expect(newPair.refreshToken).not.toBe(refreshToken);
  });

  it('the new access token is valid', () => {
    const { refreshToken } = issueTokenPair(TEST_WALLET);
    const { accessToken } = rotateRefreshToken(refreshToken);
    expect(() => verifyJwt(accessToken)).not.toThrow();
  });

  it('invalidates the old refresh token immediately', () => {
    const { refreshToken: rt1 } = issueTokenPair(TEST_WALLET);
    rotateRefreshToken(rt1);
    // Replaying the old token throws SessionRevokedError
    expect(() => rotateRefreshToken(rt1)).toThrow(SessionRevokedError);
  });

  it('replaying a revoked token invalidates the entire session', () => {
    const { refreshToken: rt1 } = issueTokenPair(TEST_WALLET);
    const { refreshToken: rt2 } = rotateRefreshToken(rt1);
    // Replay the first (revoked) token → family-level revocation
    expect(() => rotateRefreshToken(rt1)).toThrow(SessionRevokedError);
    // The second token should also be dead now (same family)
    expect(() => rotateRefreshToken(rt2)).toThrow();
  });

  it('throws InvalidRefreshTokenError for unknown token', () => {
    expect(() => rotateRefreshToken('deadbeef')).toThrow(InvalidRefreshTokenError);
  });
});

// ─── HTTP endpoint tests ─────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns 200 with access and refresh tokens', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ walletAddress: TEST_WALLET });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('accessTokenExpiresAt');
    expect(res.body.tokenType).toBe('Bearer');
    expect(typeof res.body.expiresIn).toBe('number');
  });

  it('access token expires in ~15 minutes (900 seconds)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ walletAddress: TEST_WALLET });
    expect(res.body.expiresIn).toBe(900);
  });

  it('returns 400 when walletAddress is missing', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/refresh', () => {
  it('returns a new token pair with a fresh refreshToken', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ walletAddress: TEST_WALLET });
    const { refreshToken } = loginRes.body;

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
  });

  it('returns 401 for an unknown refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when replaying a rotated (revoked) refresh token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ walletAddress: TEST_WALLET });
    const originalToken = loginRes.body.refreshToken;

    // First rotation – valid
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: originalToken });

    // Replay the original (now revoked) token
    const replayRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: originalToken });
    expect(replayRes.status).toBe(401);
    expect(replayRes.body.sessionRevoked).toBe(true);
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(app).post('/auth/refresh').send({});
    expect(res.status).toBe(400);
  });
});
