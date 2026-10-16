/**
 * API contract schema snapshots for backward-compatibility checks (Issue #711).
 *
 * Committed JSON snapshots describe the shape of critical public endpoint responses.
 * CI fails when a required field is removed or its type changes.
 *
 * Issue #1561: bulk/admin export endpoint shapes are now included so that
 * bulkExportJobs.ts and admin export routes cannot drift undetected.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

export const SNAPSHOT_DIR = path.join(__dirname, '..', 'schema-snapshots');

/** Critical public endpoints whose response contracts must remain backward-compatible. */
export const CRITICAL_ENDPOINTS = [
  'GET /health',
  'GET /ready',
  'GET /api/v1/vault/summary',
  'GET /api/v1/transactions',
  'GET /api/v1/vaults',
  // Issue #1561 — bulk / admin export routes
  'POST /admin/exports/bulk',
  'GET /admin/exports/bulk/jobs',
  'GET /admin/exports/bulk/jobs/:id',
  'GET /admin/exports/jobs',
  'POST /admin/reports/exports',
  'GET /admin/reports/exports/manifests',
] as const;

export type CriticalEndpoint = (typeof CRITICAL_ENDPOINTS)[number];

const HealthCheckValueSchema = z.enum(['up', 'down', 'degraded', 'unknown']);

export const HealthResponseSchema = z
  .object({
    status: z.string(),
    timestamp: z.string(),
    uptime: z.number(),
    environment: z.string(),
    lastIndexedLedger: z.number(),
    checks: z.object({
      api: HealthCheckValueSchema,
      cache: HealthCheckValueSchema,
      stellarRpc: HealthCheckValueSchema,
      databasePrimary: HealthCheckValueSchema,
      databaseReplica: HealthCheckValueSchema,
      prisma: HealthCheckValueSchema,
      jobs: HealthCheckValueSchema,
      indexer: HealthCheckValueSchema,
    }),
    sorobanCircuitBreaker: z.object({
      state: z.string(),
      failures: z.number(),
      retryAfterMs: z.number(),
    }),
  })
  .strict();

export const ReadyResponseSchema = z
  .object({
    ready: z.boolean(),
    timestamp: z.string(),
    dependencies: z.object({
      cache: z.boolean(),
      stellarRpc: z.boolean(),
      database: z.boolean(),
      prisma: z.boolean(),
      indexer: z.boolean(),
      redis: z.object({
        status: z.enum(['up', 'down']),
        optional: z.boolean().optional(),
        latencyMs: z.number().optional(),
        error: z.string().optional(),
      }),
    }),
  })
  .strict();

export const VaultSummaryResponseSchema = z
  .object({
    // Money fields are strings throughout this API (Decimal-backed, to avoid
    // floating-point precision loss) — see buildVaultSummaryResponseFromDb in
    // index.ts, which returns totalAssets/totalShares/sharePrice as strings.
    totalAssets: z.string(),
    totalShares: z.string(),
    sharePrice: z.string(),
    apy: z.number(),
    timestamp: z.string(),
  })
  .strict();

export const TransactionItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(['deposit', 'withdrawal']),
    status: z.enum(['pending', 'completed', 'failed']),
    amount: z.string(),
    asset: z.string(),
    timestamp: z.string(),
    transactionHash: z.string(),
    walletAddress: z.string(),
  })
  .strict();

export const PaginationMetaSchema = z
  .object({
    count: z.number(),
    limit: z.number(),
    total: z.number().nullable(),
    nextCursor: z.string().nullable(),
    prevCursor: z.string().nullable(),
    currentPage: z.number().nullable(),
    totalPages: z.number().nullable(),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
  })
  .strict();

export const TransactionsListResponseSchema = z
  .object({
    data: z.array(TransactionItemSchema),
    pagination: PaginationMetaSchema,
    timestamp: z.string(),
  })
  .strict();

/**
 * Public projection of a vault row. `tenantId` is intentionally absent — the
 * list route never exposes it (Issue #1430).
 */
export const VaultItemSchema = z
  .object({
    id: z.string(),
    aum: z.number(),
    tvlUsd: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const VaultListResponseSchema = z
  .object({
    data: z.array(VaultItemSchema),
    pagination: PaginationMetaSchema,
    timestamp: z.string(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Bulk / admin export schemas (Issue #1561)
// ---------------------------------------------------------------------------

/** Shape of BulkExportJobRecord as returned by the API. */
export const BulkExportJobSchema = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']),
    format: z.enum(['csv', 'json']),
    generatedBy: z.string(),
    filters: z.record(z.unknown()),
    totalRows: z.number(),
    processedRows: z.number(),
    errorRows: z.number(),
    artifactId: z.string().nullable(),
    errorMessage: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .strict();

/**
 * POST /admin/exports/bulk
 * 201 response: job created, async processing started.
 */
export const BulkExportCreateResponseSchema = z
  .object({
    message: z.string(),
    job: BulkExportJobSchema,
    timestamp: z.string(),
  })
  .strict();

/**
 * GET /admin/exports/bulk/jobs
 * Paginated list of bulk export jobs.
 */
export const BulkExportJobsListResponseSchema = z
  .object({
    data: z.array(BulkExportJobSchema),
    pagination: PaginationMetaSchema,
    timestamp: z.string(),
    jobs: z.array(BulkExportJobSchema),
    meta: z
      .object({
        count: z.number(),
        limit: z.number(),
        timestamp: z.string(),
      })
      .strict(),
  })
  .strict();

/**
 * GET /admin/exports/bulk/jobs/:id
 * Single bulk export job detail.
 */
export const BulkExportJobDetailResponseSchema = z
  .object({
    job: BulkExportJobSchema,
  })
  .strict();

/** Shape of a transaction export job record (legacy admin exports). */
export const AdminExportJobSchema = z
  .object({
    id: z.string(),
    format: z.enum(['csv', 'json']),
    generatedBy: z.string(),
    walletAddress: z.string().nullable().optional(),
    rowCount: z.number(),
    fileName: z.string(),
    checksum: z.string(),
    checksumAlgorithm: z.string(),
    status: z.string().optional(),
    createdAt: z.string(),
  })
  .strict();

/**
 * GET /admin/exports/jobs
 * Paginated list of legacy transaction export job records.
 */
export const AdminExportJobsListResponseSchema = z
  .object({
    data: z.array(AdminExportJobSchema),
    pagination: PaginationMetaSchema,
    timestamp: z.string(),
    jobs: z.array(AdminExportJobSchema),
    meta: z
      .object({
        count: z.number(),
        limit: z.number(),
        filters: z
          .object({
            format: z.enum(['csv', 'json']).nullable(),
            generatedBy: z.string().nullable(),
            walletAddress: z.string().nullable(),
            checksum: z.string().nullable(),
            from: z.string().nullable(),
            to: z.string().nullable(),
          })
          .strict(),
        timestamp: z.string(),
      })
      .strict(),
  })
  .strict();

/** Shape of an ExportManifestRecord as returned by the API. */
export const ExportManifestSchema = z
  .object({
    id: z.string(),
    requester: z.string(),
    reportType: z.string(),
    filters: z.record(z.unknown()),
    checksum: z.string(),
    generatedAt: z.string(),
    fileName: z.string(),
    rowCount: z.number(),
    bulkExportJobId: z.string().optional(),
    artifactId: z.string().optional(),
  })
  .strict();

/**
 * POST /admin/reports/exports
 * 201 response: manifest created.
 */
export const AdminReportExportResponseSchema = z
  .object({
    message: z.string(),
    manifest: ExportManifestSchema,
  })
  .strict();

/**
 * GET /admin/reports/exports/manifests
 * Paginated list of immutable export manifests.
 */
export const AdminReportManifestsListResponseSchema = z
  .object({
    data: z.array(ExportManifestSchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    timestamp: z.string(),
  })
  .strict();

export const ENDPOINT_SCHEMAS: Record<CriticalEndpoint, z.ZodTypeAny> = {
  'GET /health': HealthResponseSchema,
  'GET /ready': ReadyResponseSchema,
  'GET /api/v1/vault/summary': VaultSummaryResponseSchema,
  'GET /api/v1/transactions': TransactionsListResponseSchema,
  'GET /api/v1/vaults': VaultListResponseSchema,
  // Issue #1561 — bulk / admin export routes
  'POST /admin/exports/bulk': BulkExportCreateResponseSchema,
  'GET /admin/exports/bulk/jobs': BulkExportJobsListResponseSchema,
  'GET /admin/exports/bulk/jobs/:id': BulkExportJobDetailResponseSchema,
  'GET /admin/exports/jobs': AdminExportJobsListResponseSchema,
  'POST /admin/reports/exports': AdminReportExportResponseSchema,
  'GET /admin/reports/exports/manifests': AdminReportManifestsListResponseSchema,
};

export function endpointToFilename(endpoint: CriticalEndpoint): string {
  return endpoint.replace(/\s+/g, '-').replace(/\//g, '_').toLowerCase() + '.json';
}

export function snapshotPathFor(endpoint: CriticalEndpoint): string {
  return path.join(SNAPSHOT_DIR, endpointToFilename(endpoint));
}

export interface JsonSchemaShape {
  type?: string;
  properties?: Record<string, JsonSchemaShape>;
  required?: string[];
  items?: JsonSchemaShape;
  enum?: unknown[];
  additionalProperties?: boolean;
}

/** Convert a Zod object schema into a simplified JSON-schema-like shape for snapshots. */
export function zodToJsonShape(schema: z.ZodTypeAny): JsonSchemaShape {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, JsonSchemaShape> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonShape(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  }

  if (schema instanceof z.ZodOptional) {
    return zodToJsonShape(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodNullable) {
    return zodToJsonShape(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: [...schema.options] };
  }

  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }

  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonShape(schema.element as z.ZodTypeAny) };
  }

  return { type: 'unknown' };
}

export function generateSnapshotFor(endpoint: CriticalEndpoint): JsonSchemaShape {
  return zodToJsonShape(ENDPOINT_SCHEMAS[endpoint]);
}

export function writeAllSnapshots(): void {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const endpoint of CRITICAL_ENDPOINTS) {
    const snapshot = generateSnapshotFor(endpoint);
    fs.writeFileSync(snapshotPathFor(endpoint), JSON.stringify(snapshot, null, 2) + '\n');
  }
}

export interface SchemaCompatibilityIssue {
  path: string;
  message: string;
}

function isObjectShape(value: JsonSchemaShape | undefined): value is JsonSchemaShape {
  return value?.type === 'object' && typeof value.properties === 'object';
}

/** Detect breaking changes: removed fields, type changes, or newly required fields. */
export function diffSchemaShapes(
  baseline: JsonSchemaShape,
  current: JsonSchemaShape,
  prefix = '',
): SchemaCompatibilityIssue[] {
  const issues: SchemaCompatibilityIssue[] = [];
  const at = (segment: string) => (prefix ? `${prefix}.${segment}` : segment);

  if (baseline.type !== current.type) {
    issues.push({
      path: prefix || '(root)',
      message: `type changed from ${baseline.type ?? 'unknown'} to ${current.type ?? 'unknown'}`,
    });
    return issues;
  }

  if (isObjectShape(baseline) && isObjectShape(current)) {
    const baselineProps = baseline.properties ?? {};
    const currentProps = current.properties ?? {};
    const baselineRequired = new Set(baseline.required ?? []);
    const currentRequired = new Set(current.required ?? []);

    for (const key of Object.keys(baselineProps)) {
      const childPath = at(key);
      if (!(key in currentProps)) {
        issues.push({ path: childPath, message: 'field removed' });
        continue;
      }
      issues.push(...diffSchemaShapes(baselineProps[key], currentProps[key], childPath));
    }

    for (const key of Object.keys(currentProps)) {
      if (!(key in baselineProps)) {
        issues.push({ path: at(key), message: 'new field added to live schema (snapshot drift)' });
        issues.push({ path: at(key), message: 'new field added — regenerate snapshots with npm run snapshots:write' });
        continue;
      }
    }

    for (const key of baselineRequired) {
      if (!(key in baselineProps)) {
        issues.push({ path: at(key), message: 'required field missing from snapshot properties (orphaned reference)' });
      }
      if (!(key in currentProps)) {
        issues.push({ path: at(key), message: 'field removed from live schema but still required in snapshot' });
      } else if (!currentRequired.has(key)) {
        issues.push({ path: at(key), message: 'field is no longer required (may be breaking for strict clients)' });
      }
    }

    for (const key of currentRequired) {
      if (!(key in currentProps)) {
        issues.push({ path: at(key), message: 'required field missing from live schema properties (invalid schema)' });
        continue;
      }
      if (!baselineRequired.has(key)) {
        issues.push({ path: at(key), message: 'field is now required — regenerate snapshots with npm run snapshots:write' });
      }
    }
  }

  if (baseline.type === 'array' && current.type === 'array') {
    if (baseline.items && current.items) {
      issues.push(...diffSchemaShapes(baseline.items, current.items, `${prefix}[]`));
    } else if (baseline.items && !current.items) {
      issues.push({ path: `${prefix}[]`, message: 'array item schema removed' });
    }
  }

  if (baseline.enum && current.enum) {
    const removed = baseline.enum.filter((value) => !current.enum?.includes(value));
    if (removed.length > 0) {
      issues.push({
        path: prefix || '(root)',
        message: `enum values removed: ${removed.join(', ')}`,
      });
    }
  }

  return issues;
}

export function loadSnapshot(endpoint: CriticalEndpoint): JsonSchemaShape | null {
  const filePath = snapshotPathFor(endpoint);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonSchemaShape;
}

export function checkSnapshotCompatibility(): SchemaCompatibilityIssue[] {
  const issues: SchemaCompatibilityIssue[] = [];

  for (const endpoint of CRITICAL_ENDPOINTS) {
    const baseline = loadSnapshot(endpoint);
    if (!baseline) {
      issues.push({ path: endpoint, message: 'missing committed snapshot file' });
      continue;
    }

    const current = generateSnapshotFor(endpoint);
    issues.push(...diffSchemaShapes(baseline, current, endpoint));
  }

  return issues;
}

export function validateResponseAgainstSchema(
  endpoint: CriticalEndpoint,
  payload: unknown,
): { success: boolean; error?: string } {
  const schema = ENDPOINT_SCHEMAS[endpoint];
  const result = schema.safeParse(payload);
  if (result.success) {
    return { success: true };
  }
  return { success: false, error: result.error.message };
}
