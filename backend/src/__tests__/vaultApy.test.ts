/**
 * Tests for the APY calculation service (Issue #1456).
 *
 * Verifies that a vault with zero shares (or insufficient price history)
 * returns apy: null / apyStatus: 'insufficient_data' instead of Infinity.
 *
 * Integration tests for GET /api/v1/vaults/:id/apy are in vaultApyEndpoint.test.ts.
 */

import { computeVaultApy } from '../services/apy';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../prismaClient', () => ({
  getPrismaClient: () => mockPrisma,
}));

const mockVaultState = {
  findUnique: jest.fn(),
};
const mockSharePriceSnapshot = {
  findMany: jest.fn(),
};
const mockPrisma = {
  vaultState: mockVaultState,
  sharePriceSnapshot: mockSharePriceSnapshot,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Unit: computeVaultApy ────────────────────────────────────────────────────

describe('computeVaultApy()', () => {
  it('returns null + insufficient_data when totalShares is 0', async () => {
    mockVaultState.findUnique.mockResolvedValue({ id: 1, totalShares: '0', totalAssets: '0' });

    const result = await computeVaultApy(1);

    expect(result.apy).toBeNull();
    expect(result.apyStatus).toBe('insufficient_data');
    // Snapshot never queried — we bail early
    expect(mockSharePriceSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('returns null + insufficient_data when vaultState is missing', async () => {
    mockVaultState.findUnique.mockResolvedValue(null);

    const result = await computeVaultApy(1);

    expect(result.apy).toBeNull();
    expect(result.apyStatus).toBe('insufficient_data');
  });

  it('returns null + insufficient_data when fewer than 2 snapshots exist', async () => {
    mockVaultState.findUnique.mockResolvedValue({ id: 1, totalShares: '1000', totalAssets: '1000' });
    mockSharePriceSnapshot.findMany.mockResolvedValue([
      { sharePrice: '1.010000', recordedAt: new Date() },
    ]);

    const result = await computeVaultApy(1);

    expect(result.apy).toBeNull();
    expect(result.apyStatus).toBe('insufficient_data');
  });

  it('returns null + insufficient_data when priceLast is 0', async () => {
    mockVaultState.findUnique.mockResolvedValue({ id: 1, totalShares: '1000', totalAssets: '1000' });
    mockSharePriceSnapshot.findMany.mockResolvedValue([
      { sharePrice: '1.010000', recordedAt: new Date() },
      { sharePrice: '0.000000', recordedAt: new Date(Date.now() - 86400000) },
    ]);

    const result = await computeVaultApy(1);

    expect(result.apy).toBeNull();
    expect(result.apyStatus).toBe('insufficient_data');
  });

  it('returns a finite apy and ok status with 2 valid snapshots', async () => {
    mockVaultState.findUnique.mockResolvedValue({ id: 1, totalShares: '1000', totalAssets: '1050' });
    mockSharePriceSnapshot.findMany.mockResolvedValue([
      { sharePrice: '1.010000', recordedAt: new Date() },
      { sharePrice: '1.000000', recordedAt: new Date(Date.now() - 86400000) },
    ]);

    const result = await computeVaultApy(1);

    expect(result.apyStatus).toBe('ok');
    expect(typeof result.apy).toBe('number');
    expect(Number.isFinite(result.apy)).toBe(true);
    // (1.01 - 1.00) / 1.00 * 365 = 3.65
    expect(result.apy).toBeCloseTo(3.65, 5);
  });

  it('result is JSON-serialisable (no Infinity or NaN) for zero-shares vault', async () => {
    mockVaultState.findUnique.mockResolvedValue({ id: 1, totalShares: '0', totalAssets: '0' });

    const result = await computeVaultApy(1);

    // JSON.stringify(Infinity) => 'null', which loses information silently.
    // Ensure the value is intentionally null so stringify is lossless.
    const serialised = JSON.stringify(result);
    const parsed = JSON.parse(serialised);
    expect(parsed.apy).toBeNull();
  });
});
