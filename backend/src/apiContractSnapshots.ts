/**
 * API contract schema snapshots for backward-compatibility checks (Issue #711).
 *
 * Committed JSON snapshots describe the shape of critical public endpoint responses.
 * CI fails when a required field is removed or its type changes.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

export const SNAPSHOT_DIR = path.join(__dirname, '..', 'schema-snapshots');

/** Critical public endpoints whose response contracts must remain backward-compatible. */
export const CRITICAL_ENDPOINTS = [
  'GET /health',
  'GET /ready',
] as const;

export type CriticalEndpoint = (typeof CRITICAL_ENDPOINTS)[number];

const HealthCheckValueSchema = z.enum(['up', 'down', 'degraded', 'unknown']);

export const HealthResponseSchema = z
  .object({
    status: z.string(),
    timestamp: z.string(),
    uptime: z.number(),
    environment: z.string(),
    checks: z.object({
      api: HealthCheckValueSchema,
      cache: HealthCheckValueSchema,
      stellarRpc: HealthCheckValueSchema,
      databasePrimary: HealthCheckValueSchema,
      databaseReplica: HealthCheckValueSchema,
      prisma: HealthCheckValueSchema,
      jobs: HealthCheckValueSchema,
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
    }),
  })
  .strict();

export const ENDPOINT_SCHEMAS: Record<CriticalEndpoint, z.ZodTypeAny> = {
  'GET /health': HealthResponseSchema,
  'GET /ready': ReadyResponseSchema,
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
    return zodToJsonShape(schema._def.innerType);
  }

  if (schema instanceof z.ZodNullable) {
    return zodToJsonShape(schema._def.innerType);
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema._def.values };
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

    for (const key of baselineRequired) {
      if (!currentRequired.has(key)) {
        issues.push({ path: at(key), message: 'field is no longer required (may be breaking for strict clients)' });
      }
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
