import { Router, Request, Response } from 'express';
import { prisma } from './prisma';
import { validateApiKey } from './middleware/apiKeyAuth';

const router = Router();

router.use(validateApiKey);

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation: string;
  actor: string;
  details: Record<string, unknown>;
}

/**
 * @openapi
 * /api/v1/audit-logs:
 *   get:
 *     summary: Audit log
 *     description: Returns paginated audit log entries for vault state changes.
 *     tags: [Audit]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
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
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req: Request, res: Response) => {
  const { operation, action, actor, limit: limitStr } = req.query;
  const limit = Math.min(parseInt(limitStr as string, 10) || 20, 100);

  const actionFilter =
    (typeof operation === 'string' && operation) ||
    (typeof action === 'string' && action) ||
    undefined;
  const actorFilter = typeof actor === 'string' && actor ? actor : undefined;

  const where = {
    ...(actionFilter ? { action: { contains: actionFilter, mode: 'insensitive' as const } } : {}),
    ...(actorFilter ? { actor: { contains: actorFilter, mode: 'insensitive' as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const data: AuditLogEntry[] = rows.map((row) => {
    let details: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        details = JSON.parse(row.metadata);
      } catch {
        details = { raw: row.metadata };
      }
    }
    return {
      id: row.id,
      timestamp: row.createdAt.toISOString(),
      operation: row.action,
      actor: row.actor,
      details,
    };
  });

  res.json({
    data,
    pagination: {
      count: data.length,
      limit,
      total,
      nextCursor: null,
      prevCursor: null,
      currentPage: null,
      totalPages: null,
      hasNextPage: data.length < total,
      hasPrevPage: false,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
