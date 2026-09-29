// src/__tests__/idempotencyFingerprint.test.ts
//
// Issue #1376: transferOrchestrator.ts fingerprints every transfer with
// buildIdempotencyFingerprint, which went missing from idempotency.ts after the
// tenant-boundaries refactor. A retry is only recognised as a replay when it
// fingerprints identically to the original, so the helper must be exported and
// stable across key order, object identity and repeated calls.
import * as idempotency from '../idempotency';
import { buildIdempotencyFingerprint, getIdempotencyHashThreshold } from '../idempotency';

describe('Issue #1376: buildIdempotencyFingerprint', () => {
  const originalThreshold = process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES;

  afterEach(() => {
    if (originalThreshold === undefined) delete process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES;
    else process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES = originalThreshold;
  });

  it('is exported from idempotency.ts for the transfer orchestrator', () => {
    expect(typeof idempotency.buildIdempotencyFingerprint).toBe('function');
    expect(typeof idempotency.getIdempotencyHashThreshold).toBe('function');
  });

  it('produces the same fingerprint for a retry with reordered keys', () => {
    const original = {
      walletAddress: 'GABC',
      amount: '100.0000000',
      operationType: 'deposit',
      memo: { ref: 'r-1', note: 'n' },
    };
    const retry = {
      memo: { note: 'n', ref: 'r-1' },
      operationType: 'deposit',
      amount: '100.0000000',
      walletAddress: 'GABC',
    };

    expect(buildIdempotencyFingerprint(retry)).toBe(buildIdempotencyFingerprint(original));
  });

  it('is deterministic across repeated calls and cloned payloads', () => {
    const payload = { amount: '5', walletAddress: 'GXYZ', operationType: 'withdrawal' };
    const first = buildIdempotencyFingerprint(payload);

    expect(buildIdempotencyFingerprint(payload)).toBe(first);
    expect(buildIdempotencyFingerprint({ ...payload })).toBe(first);
    expect(buildIdempotencyFingerprint(JSON.parse(JSON.stringify(payload)))).toBe(first);
  });

  it('distinguishes payloads that differ in value', () => {
    const a = buildIdempotencyFingerprint({ amount: '100', walletAddress: 'GABC' });
    const b = buildIdempotencyFingerprint({ amount: '101', walletAddress: 'GABC' });
    expect(a).not.toBe(b);
  });

  it('treats array order as significant', () => {
    expect(buildIdempotencyFingerprint({ legs: [1, 2] })).not.toBe(
      buildIdempotencyFingerprint({ legs: [2, 1] }),
    );
  });

  it('serialises Dates as ISO strings and handles primitives and null', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    expect(buildIdempotencyFingerprint({ at: new Date(iso) })).toBe(
      buildIdempotencyFingerprint({ at: iso }),
    );
    expect(buildIdempotencyFingerprint(null)).toBe('null');
    expect(buildIdempotencyFingerprint('x')).toBe('"x"');
    expect(buildIdempotencyFingerprint(42)).toBe('42');
  });

  it('defaults the hash threshold to 4096 bytes', () => {
    delete process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES;
    expect(getIdempotencyHashThreshold()).toBe(4096);
  });

  it('hashes payloads above the threshold into a stable, key-order-independent digest', () => {
    process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES = '64';
    const original = { blob: 'x'.repeat(200), walletAddress: 'GABC' };
    const retry = { walletAddress: 'GABC', blob: 'x'.repeat(200) };

    const fingerprint = buildIdempotencyFingerprint(original);
    expect(fingerprint).toMatch(/^hashv1:[0-9a-f]{64}$/);
    expect(buildIdempotencyFingerprint(retry)).toBe(fingerprint);
  });

  it('keeps payloads at or below the threshold as their stable string form', () => {
    process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES = '4096';
    expect(buildIdempotencyFingerprint({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
