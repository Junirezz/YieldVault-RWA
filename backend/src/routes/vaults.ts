/**
 * @file routes/vaults.ts
 * `GET /api/v1/vaults` — paginated, public listing of active vaults.
 *
 * Pagination limits (Issue #1430)
 * -------------------------------
 * This is an unauthenticated read that maps a caller-supplied `limit`
 * straight onto Prisma's `take`, so it is exactly the shape of request that
 * let `?limit=100000` OOM the API container. The route therefore sits behind
 * `enforcePaginationLimits()`, which:
 *
 *   - defaults `limit` to 20,
 *   - rejects `limit > 50` with `400` / `code: 'LIMIT_EXCEEDED'` *before*
 *     any database call (rejecting rather than clamping is deliberate: a
 *     silent clamp hides a broken or probing client behind a response that
 *     looks like a complete page),
 *   - clamps `page` into `1..1000` because the effective offset handed to
 *     the database is `(page - 1) * limit`.
 *
 * `take` is always `limit + 1` — one extra row is fetched to learn whether a
 * next page exists, so the largest possible read is `MAX_PAGE_SIZE + 1`.
 */

import { Router, Request, Response } from 'express';
import { readsLimiter } from '../rateLimiter';
import { createTimeoutFor } from '../middleware/timeoutMiddleware';
import {
  enforcePaginationLimits,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../middleware/paginationGuard';
import {
  createPaginatedResponse,
  createPaginationEnvelope,
  encodeCursor,
  type PaginatedResponse,
} from '../pagination';
import { getPrismaClient } from '../prismaClient';
import { withSpan } from '../tracing';
import { logger } from '../middleware/structuredLogging';

const router = Router();

/** Public projection of a vault row. `tenantId` is never exposed. */
export interface VaultListItem {
  id: string;
  aum: number;
  tvlUsd: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VaultRow {
  id: string;
  aum: number;
  tvlUsd: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toVaultListItem(row: VaultRow): VaultListItem {
  return {
    id: row.id,
    aum: row.aum,
    tvlUsd: row.tvlUsd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Reads one page of active vaults.
 *
 * Exported separately from the route so unit tests can exercise the query
 * construction without an HTTP round trip.
 */
export async function buildVaultsResponse(
  limit: number,
  page: number
): Promise<PaginatedResponse<VaultListItem>> {
  const prisma = getPrismaClient();
  const take = Math.min(limit, MAX_PAGE_SIZE) + 1;
  const skip = (Math.max(1, page) - 1) * limit;

  const where = { deletedAt: null };

  const [total, rows] = await Promise.all([
    prisma.vault.count({ where }),
    prisma.vault.findMany({
      where,
      // `id` breaks ties so pages stay stable when `createdAt` collides.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
      skip,
    }),
  ]);

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  const data = pageRows.map((row) => toVaultListItem(row as unknown as VaultRow));

  const pagination = createPaginationEnvelope({
    count: data.length,
    limit,
    total,
    currentPage: page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage,
    hasPrevPage: page > 1,
    nextCursor:
      hasNextPage && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null,
  });

  return createPaginatedResponse(data, pagination);
}

/**
 * GET /api/v1/vaults
 *
 * Query parameters:
 * - `limit`: items per page, 1..50 (default 20). `> 50` → 400 LIMIT_EXCEEDED.
 * - `page`: 1-based page number, clamped to 1..1000.
 */
router.get(
  '/',
  readsLimiter,
  enforcePaginationLimits({ defaultLimit: DEFAULT_PAGE_SIZE, maxLimit: MAX_PAGE_SIZE }),
  createTimeoutFor.read(),
  async (req: Request, res: Response) => {
    const { limit, page } = req.resolvedPagination ?? {
      limit: DEFAULT_PAGE_SIZE,
      page: 1,
    };

    return withSpan('vaults.list', async (span) => {
      span.setAttributes({ 'vaults.limit': limit, 'vaults.page': page });

      try {
        const response = await buildVaultsResponse(limit, page);
        res.status(200).json(response);
      } catch (error) {
        logger.log('error', 'Failed to list vaults', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
          error: 'Internal Server Error',
          status: 500,
          code: 'VAULTS_LIST_FAILED',
          message: 'Failed to fetch vaults',
        });
      }
    });
  },
);

export default router;
