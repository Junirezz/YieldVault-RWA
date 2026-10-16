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
  BulkExportJobSchema,
  BulkExportCreateResponseSchema,
  BulkExportJobsListResponseSchema,
  BulkExportJobDetailResponseSchema,
  AdminExportJobSchema,
  AdminExportJobsListResponseSchema,
  ExportManifestSchema,
  AdminReportExportResponseSchema,
  AdminReportManifestsListResponseSchema,
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

  // -------------------------------------------------------------------------
  // Issue #1561 — bulk / admin export endpoint snapshots
  // -------------------------------------------------------------------------

  describe('#1561 bulk/admin export endpoint snapshots', () => {
    const EXPORT_ENDPOINTS = [
      'POST /admin/exports/bulk',
      'GET /admin/exports/bulk/jobs',
      'GET /admin/exports/bulk/jobs/:id',
      'GET /admin/exports/jobs',
      'POST /admin/reports/exports',
      'GET /admin/reports/exports/manifests',
    ] as const;

    it('defines committed snapshot files for all new export endpoints', () => {
      for (const endpoint of EXPORT_ENDPOINTS) {
        const snapshot = loadSnapshot(endpoint as any);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.type).toBe('object');
        // Every committed snapshot should be an object with properties
        expect(snapshot?.properties).toBeDefined();
      }
    });

    it('committed export snapshots match generator output byte-for-byte', () => {
      for (const endpoint of EXPORT_ENDPOINTS) {
        const committed = fs.readFileSync(snapshotPathFor(endpoint as any), 'utf8');
        expect(committed).toBe(
          JSON.stringify(generateSnapshotFor(endpoint as any), null, 2) + '\n'
        );
      }
    });

    it('CRITICAL_ENDPOINTS now includes all 6 new export routes', () => {
      for (const endpoint of EXPORT_ENDPOINTS) {
        expect((CRITICAL_ENDPOINTS as readonly string[]).includes(endpoint)).toBe(true);
      }
      expect(CRITICAL_ENDPOINTS.length).toBeGreaterThanOrEqual(11);
    });

    it('checkSnapshotCompatibility passes for all export endpoints', () => {
      const issues = checkSnapshotCompatibility();
      const exportIssues = issues.filter((i) =>
        EXPORT_ENDPOINTS.some((ep) => i.path.startsWith(ep))
      );
      expect(exportIssues).toEqual([]);
    });

    // BulkExportJobSchema
    it('BulkExportJobSchema validates a conforming bulk export job', () => {
      const job = {
        id: 'bulk_123_abc',
        status: 'completed' as const,
        format: 'csv' as const,
        generatedBy: 'admin',
        filters: { limit: 100 },
        totalRows: 500,
        processedRows: 500,
        errorRows: 0,
        artifactId: 'art-1',
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      expect(BulkExportJobSchema.safeParse(job).success).toBe(true);
    });

    it('BulkExportJobSchema rejects missing required fields', () => {
      expect(BulkExportJobSchema.safeParse({ id: 'x', status: 'pending' }).success).toBe(false);
    });

    it('BulkExportJobSchema rejects invalid status values', () => {
      const job = {
        id: 'bulk_123',
        status: 'unknown_status',
        format: 'csv',
        generatedBy: 'admin',
        filters: {},
        totalRows: 0,
        processedRows: 0,
        errorRows: 0,
        artifactId: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      };
      expect(BulkExportJobSchema.safeParse(job).success).toBe(false);
    });

    // POST /admin/exports/bulk — create response
    it('validates a conforming POST /admin/exports/bulk response', () => {
      const job = {
        id: 'bulk_1',
        status: 'pending' as const,
        format: 'json' as const,
        generatedBy: 'admin',
        filters: {},
        totalRows: 0,
        processedRows: 0,
        errorRows: 0,
        artifactId: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      };
      const result = validateResponseAgainstSchema('POST /admin/exports/bulk' as any, {
        message: 'Bulk export job created',
        job,
        timestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });

    it('rejects POST /admin/exports/bulk response missing job field', () => {
      const result = validateResponseAgainstSchema('POST /admin/exports/bulk' as any, {
        message: 'Bulk export job created',
        timestamp: new Date().toISOString(),
      });
      expect(result.success).toBe(false);
    });

    // GET /admin/exports/bulk/jobs/:id — detail response
    it('validates a conforming GET /admin/exports/bulk/jobs/:id response', () => {
      const job = {
        id: 'bulk_2',
        status: 'completed' as const,
        format: 'csv' as const,
        generatedBy: 'admin',
        filters: { limit: 50 },
        totalRows: 200,
        processedRows: 200,
        errorRows: 0,
        artifactId: 'art-2',
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      const result = validateResponseAgainstSchema('GET /admin/exports/bulk/jobs/:id' as any, {
        job,
      });
      expect(result.success).toBe(true);
    });

    it('rejects GET /admin/exports/bulk/jobs/:id response with bad format', () => {
      const result = validateResponseAgainstSchema('GET /admin/exports/bulk/jobs/:id' as any, {
        job: { id: 'x', format: 'xml', status: 'pending' },
      });
      expect(result.success).toBe(false);
    });

    // ExportManifestSchema
    it('ExportManifestSchema validates a conforming manifest', () => {
      const manifest = {
        id: 'exp-1',
        requester: 'admin',
        reportType: 'transactions',
        filters: { from: '2026-01-01' },
        checksum: 'abc123def456',
        generatedAt: new Date().toISOString(),
        fileName: 'transactions-2026.json',
        rowCount: 42,
      };
      expect(ExportManifestSchema.safeParse(manifest).success).toBe(true);
    });

    it('ExportManifestSchema accepts optional bulkExportJobId and artifactId', () => {
      const manifest = {
        id: 'exp-2',
        requester: 'admin',
        reportType: 'transactions',
        filters: {},
        checksum: 'xyz',
        generatedAt: new Date().toISOString(),
        fileName: 'report.json',
        rowCount: 5,
        bulkExportJobId: 'bulk_99',
        artifactId: 'art-99',
      };
      expect(ExportManifestSchema.safeParse(manifest).success).toBe(true);
    });

    // POST /admin/reports/exports — manifest create response
    it('validates a conforming POST /admin/reports/exports response', () => {
      const manifest = {
        id: 'exp-3',
        requester: 'admin',
        reportType: 'transactions',
        filters: {},
        checksum: 'abc',
        generatedAt: new Date().toISOString(),
        fileName: 'report.json',
        rowCount: 1,
      };
      const result = validateResponseAgainstSchema('POST /admin/reports/exports' as any, {
        message: 'Export generated and manifest recorded',
        manifest,
      });
      expect(result.success).toBe(true);
    });

    it('rejects POST /admin/reports/exports response missing manifest field', () => {
      const result = validateResponseAgainstSchema('POST /admin/reports/exports' as any, {
        message: 'Export generated and manifest recorded',
      });
      expect(result.success).toBe(false);
    });

    // GET /admin/reports/exports/manifests — paginated list
    it('validates a conforming GET /admin/reports/exports/manifests response', () => {
      const manifest = {
        id: 'exp-4',
        requester: 'admin',
        reportType: 'transactions',
        filters: {},
        checksum: 'abc',
        generatedAt: new Date().toISOString(),
        fileName: 'report.json',
        rowCount: 10,
      };
      const result = validateResponseAgainstSchema(
        'GET /admin/reports/exports/manifests' as any,
        {
          data: [manifest],
          total: 1,
          limit: 50,
          offset: 0,
          timestamp: new Date().toISOString(),
        }
      );
      expect(result.success).toBe(true);
    });

    it('rejects GET /admin/reports/exports/manifests response missing total field', () => {
      const result = validateResponseAgainstSchema(
        'GET /admin/reports/exports/manifests' as any,
        {
          data: [],
          limit: 50,
          offset: 0,
          timestamp: new Date().toISOString(),
        }
      );
      expect(result.success).toBe(false);
    });

    // Drift detection for export schemas
    it('detects field removal in BulkExportJobSchema as a breaking change', () => {
      const baseline = zodToJsonShape(BulkExportJobSchema);
      const current = JSON.parse(JSON.stringify(baseline)) as JsonSchemaShape;
      delete current.properties?.status;
      current.required = (current.required ?? []).filter((k: string) => k !== 'status');
      const issues = diffSchemaShapes(baseline, current, 'bulk-export-job');
      expect(issues.some((i) => i.message === 'field removed')).toBe(true);
    });

    it('detects type change in ExportManifestSchema as a breaking change', () => {
      const baseline = zodToJsonShape(ExportManifestSchema);
      const current = JSON.parse(JSON.stringify(baseline)) as JsonSchemaShape;
      if (current.properties) current.properties.rowCount = { type: 'string' };
      const issues = diffSchemaShapes(baseline, current, 'export-manifest');
      expect(issues.some((i) => i.message.includes('type changed'))).toBe(true);
    });

    it('generates stable snapshot shapes for export endpoints', () => {
      for (const endpoint of EXPORT_ENDPOINTS) {
        const first = generateSnapshotFor(endpoint as any);
        const second = generateSnapshotFor(endpoint as any);
        expect(first).toEqual(second);
      }
    });
  });
});

