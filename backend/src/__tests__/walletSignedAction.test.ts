jest.mock('../middleware/structuredLogging', () => ({
  logger: { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * Unit tests for requireSignedWalletAction (signature + nonce replay protection).
 */

import type { Request, Response } from 'express';
import { requireSignedWalletAction } from '../middleware/walletSignedAction';
import { walletNonceService } from '../walletNonce';
import { buildWalletSignMessage, signWalletActionForTests } from '../walletSignature';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function mockRes() {
  const res = { statusCode: 0, body: undefined as any } as any;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res as Response & { statusCode: number; body: any };
}

async function issueSigned(action: 'deposit' | 'withdrawal' = 'deposit') {
  const issued = await walletNonceService.issue(WALLET, action, (meta) =>
    buildWalletSignMessage({ ...meta, walletAddress: WALLET }),
  );
  const signature = signWalletActionForTests({
    walletAddress: WALLET,
    action,
    nonce: issued.nonce,
    issuedAt: issued.issuedAt,
    expiresAt: issued.expiresAt,
  });
  return { nonce: issued.nonce, signature };
}

async function run(action: 'deposit' | 'withdrawal', body: Record<string, unknown>) {
  const req = { body } as Request;
  const res = mockRes();
  const next = jest.fn();
  await requireSignedWalletAction(action)(req, res, next);
  return { req, res, next };
}

describe('requireSignedWalletAction', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WALLET_NONCE_ENFORCEMENT = 'strict';
    process.env.WALLET_SIGNATURE_MODE = 'hmac';
    walletNonceService.clearForTests();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips verification when enforcement is off', async () => {
    process.env.WALLET_NONCE_ENFORCEMENT = 'off';
    const { res, next } = await run('deposit', {});
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a request with no signature under enforcement', async () => {
    const { nonce } = await issueSigned();
    const { res, next } = await run('deposit', { walletAddress: WALLET, nonce });
    expect(next).not.toHaveBeenCalled();
    // The middleware reports missing fields as 400 SIGNED_ACTION_REQUIRED.
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('SIGNED_ACTION_REQUIRED');
  });

  it('rejects an invalid signature with 401', async () => {
    const { nonce } = await issueSigned();
    const { res, next } = await run('deposit', {
      walletAddress: WALLET,
      nonce,
      signature: 'deadbeef',
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects an unknown nonce with 401', async () => {
    const { res, next } = await run('deposit', {
      walletAddress: WALLET,
      nonce: 'does-not-exist',
      signature: 'deadbeef',
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('NONCE_NOT_FOUND');
  });

  it('accepts a valid signed action once and rejects the replayed nonce', async () => {
    const { nonce, signature } = await issueSigned();
    const body = { walletAddress: WALLET, nonce, signature };

    const first = await run('deposit', { ...body });
    expect(first.next).toHaveBeenCalledTimes(1);

    const replay = await run('deposit', { ...body });
    expect(replay.next).not.toHaveBeenCalled();
    expect(replay.res.statusCode).toBe(401);
    expect(replay.res.body.code).toBe('NONCE_REPLAY');
  });

  it('rejects a nonce issued for a different action', async () => {
    const { nonce, signature } = await issueSigned('deposit');
    const { res, next } = await run('withdrawal', { walletAddress: WALLET, nonce, signature });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('NONCE_ACTION_MISMATCH');
  });
});
