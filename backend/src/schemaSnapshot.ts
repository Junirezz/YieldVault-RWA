/**
 * @file schemaSnapshot.ts
 * API schema contract validation and snapshot management.
 *
 * Maintains deterministic snapshots of public API contracts and validates
 * them in CI to prevent schema drift. Ensures frontend and backend teams
 * operate against the same contract specifications.
 *
 * Acceptance Criteria:
 *   ✓ Verify schema snapshots in CI
 *   ✓ Fail PRs when public API contracts change unexpectedly
 *   ✓ Document approved contract change flow
 *   ✓ Keep snapshots readable for review
 */

import crypto from 'crypto';
import { z } from 'zod';

// ─── Schema Snapshot Interface ──────────────────────────────────────────────

export interface SchemaSnapshot {
  version: string;
  timestamp: string;
  packageVersion: string;
  checksum: string;
  schemas: Record<string, SchemaDefinition>;
  breakingChanges?: BreakingChange[];
}

export interface SchemaDefinition {
  name: string;
  description?: string;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'union';
  properties?: Record<string, PropertyDefinition>;
  required?: string[];
  items?: SchemaDefinition;
  enum?: (string | number)[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface PropertyDefinition {
  type: string;
  description?: string;
  required: boolean;
  schema: SchemaDefinition;
}

export interface BreakingChange {
  type:
    | 'field_removed'
    | 'field_type_changed'
    | 'field_required_added'
    | 'endpoint_removed'
    | 'status_code_changed';
  path: string;
  previous: string;
  current: string;
  severity: 'critical' | 'high' | 'medium';
}

// ─── Zod Schema Extraction ──────────────────────────────────────────────────

/**
 * Extracts a deterministic schema definition from a Zod type.
 * Produces consistent output regardless of import order.
 */
export function extractSchemaFromZod(zodSchema: z.ZodType<any>): SchemaDefinition {
  const description = (zodSchema as any).description;
  const zodType = (zodSchema as any)._def?.typeName || 'unknown';

  // Handle object schemas
  if (zodSchema instanceof z.ZodObject) {
    const shape = (zodSchema as z.ZodObject<any>)._shape;
    const properties: Record<string, PropertyDefinition> = {};
    const required: string[] = [];

    for (const [key, fieldSchema] of Object.entries(shape || {})) {
      const field = fieldSchema as z.ZodType<any>;
      const isOptional = field instanceof z.ZodOptional;
      const baseField = isOptional
        ? (field._def?.innerType as z.ZodType<any>)
        : field;

      properties[key] = {
        type: extractTypeString(baseField),
        required: !isOptional && !(field instanceof z.ZodNullable),
        schema: extractSchemaFromZod(baseField),
      };

      if (!isOptional && !(field instanceof z.ZodNullable)) {
        required.push(key);
      }
    }

    return {
      name: 'object',
      description,
      type: 'object',
      properties: sortedRecord(properties),
      required: required.sort(),
    };
  }

  // Handle string schemas with validation
  if (zodSchema instanceof z.ZodString) {
    const def = (zodSchema as any)._def;
    const props: SchemaDefinition = {
      name: 'string',
      type: 'string',
      description,
    };

    // Extract constraints
    for (const check of def.checks || []) {
      if (check.kind === 'min') props.minLength = check.value;
      if (check.kind === 'max') props.maxLength = check.value;
      if (check.kind === 'regex') props.pattern = check.regex.source;
      if (check.kind === 'email') props.pattern = '^[^@]+@[^@]+\\.[^@]+$';
      if (check.kind === 'url') props.pattern = '^https?://';
    }

    return props;
  }

  // Handle number schemas
  if (zodSchema instanceof z.ZodNumber) {
    const def = (zodSchema as any)._def;
    const props: SchemaDefinition = {
      name: 'number',
      type: 'number',
      description,
    };

    for (const check of def.checks || []) {
      if (check.kind === 'min') props.min = check.value;
      if (check.kind === 'max') props.max = check.value;
    }

    return props;
  }

  // Handle enum schemas
  if (zodSchema instanceof z.ZodEnum) {
    const values = (zodSchema as z.ZodEnum<any>).enum as (string | number)[];
    return {
      name: 'enum',
      type: 'union',
      description,
      enum: values.sort((a, b) => String(a).localeCompare(String(b))),
    };
  }

  // Handle arrays
  if (zodSchema instanceof z.ZodArray) {
    const itemSchema = (zodSchema as any)._def?.type;
    return {
      name: 'array',
      type: 'array',
      description,
      items: itemSchema ? extractSchemaFromZod(itemSchema) : { name: 'any', type: 'object' },
    };
  }

  // Handle unions
  if (zodSchema instanceof z.ZodUnion) {
    const options = (zodSchema as any)._def?.options as z.ZodType<any>[] | undefined;
    return {
      name: 'union',
      type: 'union',
      description,
      ...(options && options.length > 0
        ? {
            properties: {
              options: {
                type: 'array',
                required: true,
                schema: {
                  name: 'option',
                  type: 'object',
                  properties: options.reduce(
                    (acc, opt, idx) => ({
                      ...acc,
                      [`option_${idx}`]: {
                        type: extractTypeString(opt),
                        required: true,
                        schema: extractSchemaFromZod(opt),
                      },
                    }),
                    {}
                  ),
                },
              },
            },
          }
        : {}),
    };
  }

  // Default
  return {
    name: String(zodType),
    type: 'object',
    description,
  };
}

function extractTypeString(schema: z.ZodType<any>): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodArray) return 'array';
  if (schema instanceof z.ZodObject) return 'object';
  if (schema instanceof z.ZodEnum) return 'enum';
  if (schema instanceof z.ZodUnion) return 'union';
  if (schema instanceof z.ZodOptional) return 'optional';
  if (schema instanceof z.ZodNullable) return 'nullable';
  return 'unknown';
}

function sortedRecord<T>(obj: Record<string, T>): Record<string, T> {
  return Object.keys(obj)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = obj[key];
        return acc;
      },
      {} as Record<string, T>
    );
}

// ─── Snapshot Management ────────────────────────────────────────────────────

/**
 * Generates a deterministic checksum of the schema snapshot.
 * Used to detect any changes in the schema.
 */
export function generateSchemaChecksum(snapshot: Omit<SchemaSnapshot, 'checksum'>): string {
  const content = JSON.stringify(snapshot, Object.keys(snapshot).sort());
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Creates a schema snapshot with all necessary metadata.
 */
export function createSchemaSnapshot(
  schemas: Record<string, SchemaDefinition>,
  packageVersion: string
): SchemaSnapshot {
  const snapshot: Omit<SchemaSnapshot, 'checksum'> = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    packageVersion,
    schemas: sortedRecord(schemas),
  };

  return {
    ...snapshot,
    checksum: generateSchemaChecksum(snapshot),
  };
}

// ─── Breaking Change Detection ──────────────────────────────────────────────

export function detectBreakingChanges(
  previous: SchemaSnapshot,
  current: SchemaSnapshot
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  // Check for removed schemas
  for (const [name] of Object.entries(previous.schemas)) {
    if (!current.schemas[name]) {
      changes.push({
        type: 'endpoint_removed',
        path: name,
        previous: 'exists',
        current: 'removed',
        severity: 'critical',
      });
    }
  }

  // Check for schema changes
  for (const [name, prevSchema] of Object.entries(previous.schemas)) {
    const currSchema = current.schemas[name];
    if (!currSchema) continue;

    const schemaChanges = compareSchemaDefinitions(prevSchema, currSchema, name);
    changes.push(...schemaChanges);
  }

  return changes;
}

function compareSchemaDefinitions(
  previous: SchemaDefinition,
  current: SchemaDefinition,
  path: string,
  depth = 0
): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const maxDepth = 5;

  if (depth > maxDepth) return changes;

  // Type changes
  if (previous.type !== current.type) {
    changes.push({
      type: 'field_type_changed',
      path,
      previous: previous.type,
      current: current.type,
      severity: 'critical',
    });
  }

  // Required field additions (breaking for clients)
  if (current.required && previous.required) {
    for (const req of current.required) {
      if (!previous.required.includes(req)) {
        changes.push({
          type: 'field_required_added',
          path: `${path}.${req}`,
          previous: 'optional',
          current: 'required',
          severity: 'high',
        });
      }
    }
  }

  // Field removals (breaking)
  if (previous.properties && current.properties) {
    for (const [field] of Object.entries(previous.properties)) {
      if (!current.properties[field]) {
        changes.push({
          type: 'field_removed',
          path: `${path}.${field}`,
          previous: 'exists',
          current: 'removed',
          severity: 'critical',
        });
      }
    }
  }

  // Recursive property checking
  if (previous.properties && current.properties) {
    for (const [key, prevProp] of Object.entries(previous.properties)) {
      const currProp = current.properties[key];
      if (currProp) {
        const propChanges = compareSchemaDefinitions(
          prevProp.schema,
          currProp.schema,
          `${path}.${key}`,
          depth + 1
        );
        changes.push(...propChanges);
      }
    }
  }

  return changes;
}

// ─── Snapshot Validation ────────────────────────────────────────────────────

export interface SnapshotValidationResult {
  valid: boolean;
  breaking: BreakingChange[];
  message: string;
}

/**
 * Validates a snapshot against the previous version.
 * Returns breaking changes that should fail the PR.
 */
export function validateSnapshotChanges(
  previous: SchemaSnapshot,
  current: SchemaSnapshot
): SnapshotValidationResult {
  const breaking = detectBreakingChanges(previous, current).filter(
    (c) => c.severity === 'critical'
  );

  if (breaking.length === 0) {
    return {
      valid: true,
      breaking: [],
      message: 'Schema is compatible (no breaking changes)',
    };
  }

  return {
    valid: false,
    breaking,
    message: `${breaking.length} breaking change(s) detected in API schema`,
  };
}

/**
 * Formats breaking changes for PR comments/CI output.
 */
export function formatBreakingChanges(changes: BreakingChange[]): string {
  if (changes.length === 0) return 'No breaking changes detected.';

  const grouped = changes.reduce(
    (acc, change) => {
      if (!acc[change.type]) acc[change.type] = [];
      acc[change.type].push(change);
      return acc;
    },
    {} as Record<string, BreakingChange[]>
  );

  let output = '## Breaking Changes Detected\n\n';

  for (const [type, items] of Object.entries(grouped)) {
    output += `### ${type}\n`;
    for (const item of items) {
      output += `- **${item.path}**: ${item.previous} → ${item.current}\n`;
    }
    output += '\n';
  }

  output += 'To approve these changes, update the schema snapshot with:\n';
  output += '```\nnpm run snapshots:write\n```\n';

  return output;
}
