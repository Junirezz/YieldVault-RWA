/**
 * Tests for Issue #711 - API contract schema snapshots.
 */

import {
  CRITICAL_ENDPOINTS,
  checkSnapshotCompatibility,
  diffSchemaShapes,
  generateSnapshotFor,
  loadSnapshot,
  snapshotPathFor,
  validateResponseAgainstSchema,
  zodToJsonShape,
  HealthResponseSchema,
  JsonSchemaShape,
} from '../apiContractSnapshots';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'schema-snapshots');

describe('#711 API contract schema snapshots', () => {
  it('defines snapshots for all critical public endpoints', () => {
    expect(CRITICAL_ENDPOINTS.length).toBeGreaterThanOrEqual(4);
    for (const endpoint of CRITICAL_ENDPOINTS) {
      const snapshot = loadSnapshot(endpoint);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.type).toBe('object');
    }
  });

  it('passes backward-compatibility check against committed snapshots', () => {
    const issues = checkSnapshotCompatibility();
    expect(issues).toEqual([]);
  });

  it('detects removed fields as breaking changes', () => {
    const baseline = zodToJsonShape(HealthResponseSchema);
    const current = JSON.parse(JSON.stringify(baseline)) as typeof baseline;
    delete current.properties?.status;

    const issues = diffSchemaShapes(baseline, current, 'GET /health');
    expect(issues.some((issue) => issue.message === 'field removed')).toBe(true);
  });

  it('detects newly added required fields as breaking changes', () => {
    // diffSchemaShapes(baseline, current) compares a committed snapshot against
    // the live schema, so the shape that is missing the field is the baseline
    // and the shape carrying it is `current`.
    const current = zodToJsonShape(HealthResponseSchema);
    const baseline = JSON.parse(JSON.stringify(current)) as typeof current;
    // Simulate an older snapshot that is missing the 'indexer' field
    delete baseline.properties?.checks?.properties?.indexer;
    baseline.properties!.checks!.required = (baseline.properties!.checks!.required ?? []).filter(
      (k: string) => k !== 'indexer',
    );

    const issues = diffSchemaShapes(baseline, current, 'GET /health');
    expect(issues.some((issue) => issue.message.includes('now required'))).toBe(true);
  });

  it('validates a conforming health payload', () => {
    const result = validateResponseAgainstSchema('GET /health', {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: 12.5,
      environment: 'test',
      lastIndexedLedger: 0,
      checks: {
        api: 'up',
        cache: 'up',
        stellarRpc: 'up',
        databasePrimary: 'up',
        databaseReplica: 'up',
        prisma: 'up',
        jobs: 'up',
        indexer: 'up',
      },
      sorobanCircuitBreaker: {
        state: 'closed',
        failures: 0,
        retryAfterMs: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects health payloads missing required fields', () => {
    const result = validateResponseAgainstSchema('GET /health', {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });

  it('validates a conforming vault summary payload', () => {
    const result = validateResponseAgainstSchema('GET /api/v1/vault/summary', {
      totalAssets: '1000',
      totalShares: '500',
      sharePrice: '1.000000',
      apy: 8.5,
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('validates a conforming transactions list payload', () => {
    const result = validateResponseAgainstSchema('GET /api/v1/transactions', {
      data: [{
        id: 'tx-1',
        type: 'deposit',
        status: 'completed',
        amount: '100',
        asset: 'USDC',
        timestamp: new Date().toISOString(),
        transactionHash: 'abc123',
        walletAddress: 'GABC123',
      }],
      pagination: {
        count: 1,
        limit: 20,
        total: 1,
        nextCursor: null,
        prevCursor: null,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('writes snapshot files under schema-snapshots/', () => {
    for (const endpoint of CRITICAL_ENDPOINTS) {
      const filename = endpoint.replace(/\s+/g, '-').replace(/\//g, '_').toLowerCase() + '.json';
      expect(fs.existsSync(path.join(SNAPSHOT_DIR, filename))).toBe(true);
    }
  });

  it('generates stable snapshot shapes for each endpoint', () => {
    for (const endpoint of CRITICAL_ENDPOINTS) {
      const first = generateSnapshotFor(endpoint);
      const second = generateSnapshotFor(endpoint);
      expect(first).toEqual(second);
    }
  });

  it('detects orphaned required references in baseline snapshot', () => {
    const baseline = JSON.parse(JSON.stringify(zodToJsonShape(HealthResponseSchema))) as JsonSchemaShape;
    delete baseline.properties?.checks.properties?.api;
    const current = zodToJsonShape(HealthResponseSchema);
    const issues = diffSchemaShapes(baseline, current, 'GET /health');
    expect(issues.some((issue) => issue.message === 'required field missing from snapshot properties (orphaned reference)' && issue.path === 'GET /health.checks.api')).toBe(true);
  });

  it('detects new fields added to live schema', () => {
    const baseline = zodToJsonShape(HealthResponseSchema);
    const current = JSON.parse(JSON.stringify(baseline)) as JsonSchemaShape;
    if (!current.properties) current.properties = {};
    current.properties.newField = { type: 'string' };
    const issues = diffSchemaShapes(baseline, current, 'GET /health');
    expect(issues.some((issue) => issue.message === 'new field added to live schema (snapshot drift)' && issue.path === 'GET /health.newField')).toBe(true);
  });

  // #1378: committed snapshots must be generator output, not hand-edited, and
  // must carry the indexer check that /health and /ready emit.
  it('committed snapshots match generator output byte-for-byte', () => {
    for (const endpoint of CRITICAL_ENDPOINTS) {
      const committed = fs.readFileSync(snapshotPathFor(endpoint), 'utf8');
      expect(committed).toBe(JSON.stringify(generateSnapshotFor(endpoint), null, 2) + '\n');
    }
  });

  it('health and ready snapshots include the indexer check', () => {
    const health = loadSnapshot('GET /health');
    expect(health?.properties?.checks?.properties?.indexer).toEqual({
      type: 'string',
      enum: ['up', 'down', 'degraded', 'unknown'],
    });
    expect(health?.properties?.checks?.required).toContain('indexer');

    const ready = loadSnapshot('GET /ready');
    expect(ready?.properties?.dependencies?.properties?.indexer).toEqual({ type: 'boolean' });
    expect(ready?.properties?.dependencies?.required).toContain('indexer');
  });
});
