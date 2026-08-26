import { Router, Request, Response } from 'express';
import { logger } from './middleware/structuredLogging';
import { withSpan, getCurrentTraceId } from './tracing';
import { getPrismaClient } from './prismaClient';
import { normalizeWalletAddress } from './walletUtils';
import {
  parsePaginationQuery,
  sendPaginatedResponse,
  DEFAULT_PAGINATION_CONFIG,
  encodeCursor,
  decodeCursor,
  createPaginationEnvelope,
} from './pagination';
import { DateRangeParseError, parseUtcDateRange, type ParsedUtcDateRange } from './dateRange';
import {
  resolveTransactionSort,
  buildTransactionOrderBy,
  buildTransactionCursorFilter,
  parseTypeFilter,
  parseStatusFilter,
} from './transactionQuery';
import { buildTransactionsResponse } from './listEndpoints';
import { cacheMiddleware } from './middleware/cache';
import { tenantGuard } from './middleware/tenantGuard';
import { Permission } from './middleware/rbac';
import { createTimeoutFor } from './middleware/timeoutMiddleware';
import { validate, TransactionListQuerySchema } from './middleware/validate';

const router = Router();
const CACHE_TTL_MS = parseInt(process.env.CACHE_LIST_ENDPOINTS_TTL_MS || '30000', 10);

/**
 * GET /api/v1/transactions
 * Retrieve transaction history with cursor-based pagination and filtering.
 * 
 * Query Parameters:
 * - limit: Items per page (1-100, default 20)
 * - cursor: Opaque cursor for pagination (from previous response's nextCursor)
 * - type: Filter by transaction type ('deposit' or 'withdrawal', or both if omitted)
 * - status: Filter by transaction status ('pending', 'completed' or 'failed')
 * - from: Start date (ISO 8601 or YYYY-MM-DD format)
 * - to: End date (ISO 8601 or YYYY-MM-DD format)
 * - sortBy: Field to sort by — one of 'timestamp', 'type', 'status' (default: 'timestamp')
 * - sortOrder: Sort direction 'asc' or 'desc' (default: 'desc')
 * 
 * Response: Paginated list of transactions with total count and no duplicate results across pages
 */
router.get('/', 
  cacheMiddleware({ ttl: CACHE_TTL_MS }),
  tenantGuard({ 
    walletParamPath: 'query.walletAddress', 
    allowAdminBypass: true, 
    adminBypassPermission: Permission.ADMIN_READ 
  }),
  validate({ query: TransactionListQuerySchema }),
  createTimeoutFor.read(),
  async (req: Request, res: Response) => {
  const traceId = getCurrentTraceId();

  return await withSpan('transactions.list', async (span) => {
    try {
      const { type, status, walletAddress } = req.query;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!walletAddress) {
        // Validate type filter if provided
        const { error: typeError } = parseTypeFilter(typeof type === 'string' ? type : undefined);
        if (typeError) {
          res.status(400).json({ error: 'Bad Request', status: 400, message: typeError });
          return;
        }

        // Validate status filter if provided
        const { error: statusError } = parseStatusFilter(
          typeof status === 'string' ? status : undefined,
        );
        if (statusError) {
          res.status(400).json({ error: 'Bad Request', status: 400, message: statusError });
          return;
        }

        try {
          const response = await buildTransactionsResponse({
            limit: typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined,
            cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
            page: typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : undefined,
            sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
            sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
            type: typeof type === 'string' ? type : undefined,
            status: typeof status === 'string' ? status : undefined,
            from,
            to,
          });
          res.status(200).json(response);
        } catch (err) {
          if (err instanceof DateRangeParseError) {
            res.status(400).json({
              error: 'Bad Request',
              status: 400,
              message: err.message,
            });
            return;
          }

          throw err;
        }
        return;
      }

      // Validate type filter if provided
      const { types: typeFilter, error: typeError } = parseTypeFilter(
        typeof type === 'string' ? type : undefined,
      );
      if (typeError) {
        res.status(400).json({ error: 'Bad Request', status: 400, message: typeError });
        return;
      }

      // Validate status filter if provided
      const { status: statusFilter, error: statusError } = parseStatusFilter(
        typeof status === 'string' ? status : undefined,
      );
      if (statusError) {
        res.status(400).json({ error: 'Bad Request', status: 400, message: statusError });
        return;
      }

      // Parse pagination parameters
      const paginationQuery = parsePaginationQuery(req, {
        ...DEFAULT_PAGINATION_CONFIG,
        defaultSortBy: 'timestamp',
        defaultSortOrder: 'desc',
      });

      // Resolve and validate the requested sort field against the allowlist.
      const sort = resolveTransactionSort(paginationQuery.sortBy, paginationQuery.sortOrder);
      if (!sort.valid) {
        res.status(400).json({
          error: 'Bad Request',
          status: 400,
          message: `Invalid sortBy value '${sort.requested}'. Allowed values: timestamp, type, status`,
        });
        return;
      }

      // Parse and validate date range
      let dateRange: ParsedUtcDateRange = {};
      try {
        if (from || to) {
          dateRange = parseUtcDateRange({ from, to }, { maxRangeDays: 366 });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid date range';
        res.status(400).json({
          error: 'Bad Request',
          status: 400,
          message: errorMsg,
        });
        return;
      }

      span.setAttributes({
        'transaction.typeFilter': typeFilter.length > 0 ? typeFilter.join(',') : 'all',
        'transaction.statusFilter': statusFilter ?? 'all',
        'transaction.walletFilter': walletAddress ? normalizeWalletAddress(String(walletAddress)) : 'all',
        'transaction.hasDateRange': !!(dateRange.start || dateRange.end),
        'transaction.sortBy': sort.field,
        'transaction.sortOrder': sort.order,
        'pagination.limit': paginationQuery.limit,
        'pagination.hasCursor': !!paginationQuery.cursor,
      });

      const prisma = getPrismaClient();

      // Build where clause for Prisma query
      const whereClause: Record<string, any> = {};

      if (typeFilter.length > 0) {
        whereClause.type = { in: typeFilter };
      }

      if (statusFilter) {
        whereClause.status = statusFilter;
      }

      if (walletAddress) {
        whereClause.user = normalizeWalletAddress(String(walletAddress));
      }

      if (dateRange.start || dateRange.end) {
        whereClause.timestamp = {};
        if (dateRange.start) {
          whereClause.timestamp.gte = new Date(dateRange.start);
        }
        if (dateRange.end) {
          whereClause.timestamp.lte = new Date(dateRange.end);
        }
      }

      // Fetch total count for response metadata
      const total = await prisma.transaction.count({ where: whereClause });

      // Fetch transactions with cursor-based pagination. The skip count is
      // derived from the resolved sort field so pagination stays correct for
      // any sortable column, not just timestamp.
      let skip = 0;
      if (paginationQuery.cursor) {
        try {
          const decodedCursor = decodeCursor(paginationQuery.cursor);
          // The cursor is the transaction ID - we need to find its position
          const cursorTx = await prisma.transaction.findUnique({
            where: { id: decodedCursor },
          });

          if (!cursorTx) {
            res.status(400).json({
              error: 'Bad Request',
              status: 400,
              message: 'Invalid cursor value',
            });
            return;
          }

          // Count items before the cursor (under the active sort) to skip.
          skip = await prisma.transaction.count({
            where: {
              ...whereClause,
              ...buildTransactionCursorFilter(sort, cursorTx as Record<string, unknown> & { id: string }),
            },
          });
        } catch (err) {
          logger.log('error', 'Error decoding cursor', {
            error: err instanceof Error ? err.message : String(err),
            traceId,
          });
          res.status(400).json({
            error: 'Bad Request',
            status: 400,
            message: 'Invalid cursor value',
          });
          return;
        }
      }

      // Fetch limit + 1 to detect if there are more results
      const limit = paginationQuery.limit || DEFAULT_PAGINATION_CONFIG.defaultLimit;
      const transactions = await prisma.transaction.findMany({
        where: whereClause,
        orderBy: buildTransactionOrderBy(sort),
        skip,
        take: limit + 1,
      });

      // Check if there are more results
      const hasMore = transactions.length > limit;
      const data = hasMore ? transactions.slice(0, limit) : transactions;

      // Build pagination metadata
      const pagination = createPaginationEnvelope({
        count: data.length,
        limit,
        total,
        hasNextPage: hasMore,
        hasPrevPage: skip > 0,
        nextCursor: hasMore && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null,
      });

      span.setAttributes({
        'transaction.count': data.length,
        'transaction.total': total,
        'pagination.hasNextPage': hasMore,
        'pagination.hasPrevPage': skip > 0,
      });

      logger.log('info', 'Transaction history retrieved', {
        count: data.length,
        total,
        traceId,
      });

      sendPaginatedResponse(res, data, pagination, 200);
    } catch (err) {
      logger.log('error', 'Error retrieving transaction history', {
        error: err instanceof Error ? err.message : String(err),
        traceId,
      });

      res.status(500).json({
        error: 'Internal Server Error',
        status: 500,
        message: 'Failed to retrieve transaction history',
      });
    }
  });
});

export default router;
