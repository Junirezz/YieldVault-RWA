/**
 * Hard-delete guardrails for critical control-plane entities (Issue #1047).
 *
 * Lifecycle code must use conditional updates plus immutable audit events.
 * Test cleanup is the only generic-delete exception.
 */

export const CRITICAL_ENTITY_MODELS = new Set([
  'ApiKey',
  'CriticalEntityAuditEvent',
  'ScopedAdminToken',
  'Tenant',
  'WebhookEndpoint',
]);

export function assertCriticalEntityMutationAllowed(
  model: string | undefined,
  operation: string
): void {
  const mutatesImmutableAudit =
    model === 'CriticalEntityAuditEvent' &&
    ['delete', 'deleteMany', 'update', 'updateMany', 'upsert'].includes(operation);

  if (
    process.env.NODE_ENV !== 'test' &&
    model &&
    (mutatesImmutableAudit ||
      (CRITICAL_ENTITY_MODELS.has(model) && (operation === 'delete' || operation === 'deleteMany')))
  ) {
    if (mutatesImmutableAudit) {
      throw new Error('CriticalEntityAuditEvent is immutable; only create operations are allowed');
    }
    throw new Error(
      `Hard delete blocked for critical entity ${model}; use its audited lifecycle service`
    );
  }
}
