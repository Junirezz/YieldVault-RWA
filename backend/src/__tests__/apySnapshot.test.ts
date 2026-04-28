/**
 * Tests for the APY snapshot job and history endpoint (Issue #374).
 */

import request from 'supertest';
import app from '../index';
import {
  runApySnapshotJob,
  getApyHistory,
  todayUtc,
  dateMinusDays,
} from '../apySnapshot';

describe('APY Snapshot – unit', () => {
  describe('todayUtc()', () => {
    it('returns a YYYY-MM-DD string', () => {
      expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('dateMinusDays()', () => {
    it('subtracts days correctly', () => {
      expect(dateMinusDays('2025-01-10', 10)).toBe('2024-12-31');
    });

    it('handles month boundary', () => {
      expect(dateMinusDays('2025-03-01', 1)).toBe('2025-02-28');
    });
  });

  describe('runApySnapshotJob()', () => {
    it('completes without throwing', async () => {
      await expect(runApySnapshotJob()).resolves.not.toThrow();
    });
  });
});

describe('APY Snapshot – getApyHistory()', () => {
  beforeAll(async () => {
    // Seed at least one snapshot so history is non-empty
    await runApySnapshotJob();
  });

  it('returns an array of snapshot objects', async () => {
    const history = await getApyHistory(7);
    expect(Array.isArray(history)).toBe(true);
  });

  it('each snapshot has date (YYYY-MM-DD) and numeric apy', async () => {
    const history = await getApyHistory(7);
    for (const snapshot of history) {
      expect(snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof snapshot.apy).toBe('number');
    }
  });

  it('clamps days to 365 maximum', async () => {
    const history = await getApyHistory(999);
    expect(history.length).toBeLessThanOrEqual(365);
  });

  it('clamps days to 1 minimum', async () => {
    const history = await getApyHistory(0);
    // Returns at most 1 day worth of data
    expect(history.length).toBeLessThanOrEqual(1);
  });
});

describe('GET /api/v1/vault/apy/history', () => {
  it('returns 200 with data array and metadata', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('days', 30);
    expect(res.body).toHaveProperty('count');
  });

  it('accepts ?days=7 query param', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=7');
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
  });

  it('accepts ?days=365 (max)', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=365');
    expect(res.status).toBe(200);
  });

  it('each item has date and apy fields', async () => {
    // Seed a snapshot first
    await runApySnapshotJob();
    const res = await request(app).get('/api/v1/vault/apy/history?days=1');
    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('date');
      expect(res.body.data[0]).toHaveProperty('apy');
    }
  });

  it('falls back to default 30 days for invalid ?days param', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=abc');
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
  });
});
