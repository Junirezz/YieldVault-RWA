import { Router, Request, Response } from 'express';

const router = Router();

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation: 'deposit' | 'withdraw' | 'strategy_switch' | 'parameter_change';
  actor: string;
  details: Record<string, unknown>;
}

function generateMockAuditLogs(): AuditLogEntry[] {
  const now = Date.now();
  return [
    {
      id: 'audit-1',
      timestamp: new Date(now - 3_600_000).toISOString(),
      operation: 'deposit',
      actor: 'GABC...1234',
      details: { amount: 1000, shares: 990, token: 'USDC' },
    },
    {
      id: 'audit-2',
      timestamp: new Date(now - 7_200_000).toISOString(),
      operation: 'strategy_switch',
      actor: 'GDEF...5678',
      details: { from: 'BENJI', to: 'Korean Sovereign' },
    },
    {
      id: 'audit-3',
      timestamp: new Date(now - 10_800_000).toISOString(),
      operation: 'withdraw',
      actor: 'GABC...1234',
      details: { shares: 500, assets: 505, token: 'USDC' },
    },
    {
      id: 'audit-4',
      timestamp: new Date(now - 14_400_000).toISOString(),
      operation: 'parameter_change',
      actor: 'GDEF...5678',
      details: { parameter: 'min_deposit', oldValue: 100, newValue: 50 },
    },
  ];
}

/**
 * @openapi
 * /api/v1/audit-logs:
 *   get:
 *     summary: Audit log
 *     description: Returns paginated audit log entries for vault state changes.
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
 *           enum: [deposit, withdraw, strategy_switch, parameter_change]
 *       - in: query
 *         name: actor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Audit log entries
 */
router.get('/', (req: Request, res: Response) => {
  const { operation, actor, limit: limitStr } = req.query;
  const limit = Math.min(parseInt(limitStr as string, 10) || 20, 100);

  let entries = generateMockAuditLogs();

  if (typeof operation === 'string' && operation) {
    entries = entries.filter((e) => e.operation === operation);
  }

  if (typeof actor === 'string' && actor) {
    entries = entries.filter((e) =>
      e.actor.toLowerCase().includes(actor.toLowerCase()),
    );
  }

  const data = entries.slice(0, limit);

  res.json({
    data,
    pagination: {
      count: data.length,
      limit,
      total: entries.length,
      nextCursor: null,
      prevCursor: null,
      currentPage: null,
      totalPages: null,
      hasNextPage: data.length < entries.length,
      hasPrevPage: false,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
