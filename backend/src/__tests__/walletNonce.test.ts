/**
 * Tests for server-side wallet nonce tracking and signed action verification.
 */

import request from 'supertest';
import app from '../index';
import type Redis from 'ioredis';
import {
  NonceLimitExceededError,
  NonceReplayError,
  RedisNonceStore,
  walletNonceService,
  type StoredNonce,
} from '../walletNonce';
import {
  buildWalletSignMessage,
  signWalletActionForTests,
} from '../walletSignature';

const TEST_WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function enableNonceEnforcement(): void {
  process.env.WALLET_NONCE_ENFORCEMENT = 'strict';
  process.env.WALLET_SIGNATURE_MODE = 'hmac';
}

function disableNonceEnforcement(): void {
  delete process.env.WALLET_NONCE_ENFORCEMENT;
  delete process.env.WALLET_SIGNATURE_MODE;
}

async function issueAndSign(action: 'login' | 'deposit' | 'withdrawal') {
  const nonceRes = await request(app)
    .post('/api/v1/auth/nonce')
    .send({ walletAddress: TEST_WALLET, action });

  expect(nonceRes.status).toBe(200);
  const { nonce, issuedAt, expiresAt } = nonceRes.body;

  const signature = signWalletActionForTests({
    walletAddress: TEST_WALLET,
    action,
    nonce,
    issuedAt,
    expiresAt,
  });

  return { nonce, signature };
}

describe('Wallet nonce service', () => {
  beforeEach(() => {
    walletNonceService.clearForTests();
    enableNonceEnforcement();
  });

  afterEach(() => {
    disableNonceEnforcement();
  });

  it('issues a nonce with expiry metadata', async () => {
    const res = await request(app)
      .post('/api/v1/auth/nonce')
      .send({ walletAddress: TEST_WALLET, action: 'login' });

    expect(res.status).toBe(200);
    expect(res.body.nonce).toMatch(/^[a-f0-9]{48}$/);
    expect(res.body.expiresIn).toBeGreaterThan(0);
    expect(res.body.message).toContain('YieldVault Signed Action');
    expect(res.body.message).toContain(res.body.nonce);
  });

  it('reports nonce store failures as service unavailable', async () => {
    const issueSpy = jest
      .spyOn(walletNonceService, 'issue')
      .mockRejectedValueOnce(new Error('nonce store unavailable'));

    const res = await request(app)
      .post('/api/v1/auth/nonce')
      .send({ walletAddress: TEST_WALLET, action: 'login' });

    issueSpy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NONCE_STORE_UNAVAILABLE');
  });

  it('rejects replay of the same nonce on login', async () => {
    const { nonce, signature } = await issueAndSign('login');

    const first = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce, signature });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce, signature });

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('NONCE_REPLAY');
    expect(replay.body.error).toBe('Nonce Replay');
  });

  it('allows exactly one concurrent consumer for a nonce', async () => {
    const issued = await walletNonceService.issue(
      TEST_WALLET,
      'login',
      (base) => base.nonce,
    );

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        walletNonceService.consume(TEST_WALLET, 'login', issued.nonce),
      ),
    );

    const accepted = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    expect(
      rejected.every((attempt) => attempt.reason instanceof NonceReplayError),
    ).toBe(true);
  });

  it('enforces the active nonce cap under concurrent issuance', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        walletNonceService.issue(TEST_WALLET, 'deposit', (base) => base.nonce),
      ),
    );

    const issued = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );

    expect(issued).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    expect(
      rejected.every((attempt) => attempt.reason instanceof NonceLimitExceededError),
    ).toBe(true);
  });

  it('rejects login when signature does not match', async () => {
    const { nonce } = await issueAndSign('login');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce, signature: 'deadbeef'.repeat(8) });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects expired nonces', async () => {
    const issued = await walletNonceService.issue(
      TEST_WALLET,
      'login',
      (base) =>
        buildWalletSignMessage({
          walletAddress: base.walletAddress,
          action: base.action,
          nonce: base.nonce,
          issuedAt: base.issuedAt,
          expiresAt: base.expiresAt,
        }),
    );

    await walletNonceService.expireNonceForTests(issued.nonce);

    const signature = signWalletActionForTests({
      walletAddress: TEST_WALLET,
      action: 'login',
      nonce: issued.nonce,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce: issued.nonce, signature });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NONCE_EXPIRED');
    expect(res.body.error).toBe('Nonce Expired');
  });

  it('rejects vault deposit when nonce was issued for login', async () => {
    const { nonce, signature } = await issueAndSign('login');

    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        walletAddress: TEST_WALLET,
        nonce,
        signature,
        amount: '100',
        asset: 'USDC',
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NONCE_ACTION_MISMATCH');
  });
});

describe('Redis wallet nonce atomicity', () => {
  const entry: StoredNonce = {
    nonce: 'a'.repeat(48),
    walletAddress: TEST_WALLET,
    action: 'login',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    used: false,
  };

  it.each([
    [1, 'saved'],
    [0, 'limit_reached'],
    [-1, 'nonce_conflict'],
  ] as const)('maps atomic reservation result %i to %s', async (redisResult, expected) => {
    const evalMock = jest.fn().mockResolvedValue(redisResult);
    const store = new RedisNonceStore({ eval: evalMock } as unknown as Redis);

    await expect(store.saveIfBelowLimit(entry, 300, 10)).resolves.toBe(expected);
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][1]).toBe(2);
  });

  it.each([
    [0, 'consumed'],
    [1, 'not_found'],
    [2, 'wallet_mismatch'],
    [3, 'action_mismatch'],
    [4, 'expired'],
    [5, 'replay'],
  ] as const)('maps atomic consume result %i to %s', async (redisResult, expected) => {
    const evalMock = jest.fn().mockResolvedValue(redisResult);
    const store = new RedisNonceStore({ eval: evalMock } as unknown as Redis);

    await expect(
      store.consume(entry.nonce, entry.walletAddress, entry.action, Date.now()),
    ).resolves.toBe(expected);
    expect(evalMock).toHaveBeenCalledTimes(1);
  });
});

describe('Wallet nonce enforcement flag', () => {
  beforeEach(() => {
    walletNonceService.clearForTests();
    disableNonceEnforcement();
  });

  it('allows login without nonce when enforcement is off', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });
});
