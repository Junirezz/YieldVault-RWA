/**
 * Tests for Issue #711 - API contract schema snapshots.
 */

import {
  CRITICAL_ENDPOINTS,
  checkSnapshotCompatibility,
  diffSchemaShapes,
  generateSnapshotFor,
  loadSnapshot,
  validateResponseAgainstSchema,
  writeAllSnapshots,
  zodToJsonShape,
  HealthResponseSchema,
} from '../apiContractSnapshots';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'schema-snapshots');

describe('#711 API contract schema snapshots', () => {
  beforeAll(() => {
    writeAllSnapshots();
  });

  it('defines snapshots for all critical public endpoints', () => {
    expect(CRITICAL_ENDPOINTS.length).toBeGreaterThanOrEqual(2);
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

  it('validates a conforming health payload', () => {
    const result = validateResponseAgainstSchema('GET /health', {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: 12.5,
      environment: 'test',
      checks: {
        api: 'up',
        cache: 'up',
        stellarRpc: 'up',
        databasePrimary: 'up',
        databaseReplica: 'up',
        prisma: 'up',
        jobs: 'up',
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
});
