import type { Request } from 'express';

jest.mock('../prisma', () => ({ prisma: { $executeRaw: jest.fn(), $queryRaw: jest.fn() } }));
jest.mock('../middleware/apiKeyAuth', () => ({
  hashApiKey: (key: string) => require('crypto').createHash('sha256').update(key).digest('hex'),
}));

import { prisma } from '../prisma';
import {
  getApiKeyFingerprintFromHash,
  getApiKeyFingerprintFromValue,
  isApiKeyHash,
  listApiKeyAuditEvents,
  recordApiKeyAuditEvent,
  resolveApiKeyAuditActor,
} from '../apiKeyAudit';

const HASH = 'ABCDEF0123456789'.repeat(4);

function reqWith(headers: Record<string, string>, authApiKeyHash?: string): Request {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    authApiKeyHash,
  } as unknown as Request;
}

describe('apiKeyAudit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recognises 64-char hex hashes only', () => {
    expect(isApiKeyHash(HASH)).toBe(true);
    expect(isApiKeyHash('short')).toBe(false);
    expect(isApiKeyHash(123)).toBe(false);
  });

  it('derives a lowercase 16-char fingerprint and never exposes the full hash', () => {
    const fp = getApiKeyFingerprintFromHash(` ${HASH} `);
    expect(fp).toBe(`sha256:${HASH.toLowerCase().slice(0, 16)}`);
    expect(getApiKeyFingerprintFromValue('my-key')).toMatch(/^sha256:[a-f0-9]{16}$/);
  });

  it('resolves the actor from headers before falling back to the API key', () => {
    expect(resolveApiKeyAuditActor(reqWith({ 'x-admin-address': 'GADMIN' }, HASH))).toBe('GADMIN');
    expect(resolveApiKeyAuditActor(reqWith({}, HASH))).toBe(
      `apiKey:${getApiKeyFingerprintFromHash(HASH)}`,
    );
    expect(resolveApiKeyAuditActor(reqWith({}))).toBe('unknown');
  });

  it('records an audit event through the database client', async () => {
    await recordApiKeyAuditEvent({ actor: 'a', action: 'created', keyFingerprint: 'sha256:x' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('maps listed rows to ISO timestamps', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { id: '1', actor: 'a', action: 'revoked', keyFingerprint: 'sha256:x', createdAt },
    ]);
    const rows = await listApiKeyAuditEvents({ limit: 5, action: 'revoked' });
    expect(rows).toEqual([
      { id: '1', actor: 'a', action: 'revoked', keyFingerprint: 'sha256:x', createdAt: createdAt.toISOString() },
    ]);
  });
});
