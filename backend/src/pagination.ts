
/**
 * @file pagination.ts
 * Pagination utilities and types for consistent list endpoint behavior.
 *
 * Provides:
 * - Cursor-based pagination for stable ordering
 * - Offset-based pagination for simple use cases
 * - Consistent response metadata (next cursor, total count)
 * - Query parameter parsing and validation
 */

import { Request, Response, NextFunction } from 'express';
import type { ParsedUtcDateRange } from './dateRange';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Pagination query parameters accepted by list endpoints.
 */
export interface PaginationQuery {
  /** Maximum number of items to return (1-100). */
  limit?: number;
  /** Cursor for cursor-based pagination (opaque string). */
  cursor?: string;
  /** Page number for offset-based pagination (1-based). */
  page?: number;
  /** Field to sort by. */
  sortBy?: string;
  /** Sort direction: 'asc' or 'desc'. */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Pagination metadata included in list responses.
 */
export interface PaginationMeta {
  /** Number of items returned in this response. */
  count: number;
  /** Effective request limit used for this page. */
  limit: number;
  /** Total number of items available (if known). */
  total: number | null;
  /** Cursor for the next page (if more items exist). */
  nextCursor: string | null;
  /** Cursor for the previous page (if applicable). */
  prevCursor: string | null;
  /** Current page number (for offset-based pagination). */
  currentPage: number | null;
  /** Total number of pages (if total is known). */
  totalPages: number | null;
  /** Whether there are more items after this page. */
  hasNextPage: boolean;
  /** Whether there are items before this page. */
  hasPrevPage: boolean;
}

/**
 * Standard paginated response structure.
 */
export interface PaginatedResponse<T> {
  /** Response data items. */
  data: T[];
  /** Pagination metadata. */
  pagination: PaginationMeta;
  /** Response timestamp. */
  timestamp: string;
  /** Normalized UTC date range used by the query, when relevant. */
  normalizedDateRange?: ParsedUtcDateRange;
}

/**
 * Configuration for pagination behavior.
 */
export interface PaginationConfig {
  /** Default number of items per page. */
  defaultLimit: number;
  /** Maximum allowed items per page. */
  maxLimit: number;
  /**
   * Highest page number a caller may request (Issue #1430). The effective
   * offset handed to the database is `(page - 1) * limit`, so an unbounded
   * page number turns into an unbounded `skip` scan.
   */
  maxPage: number;
  /** Whether to include total count in response. */
  includeTotal: boolean;
  /** Default sort field. */
  defaultSortBy?: string;
  /** Default sort order. */
  defaultSortOrder: 'asc' | 'desc';
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_PAGINATION_CONFIG: PaginationConfig = {
  defaultLimit: 20,
  maxLimit: 100,
  maxPage: 1000,
  includeTotal: true,
  defaultSortOrder: 'desc',
};

export const CURSOR_SEPARATOR = '_';

// ─── Query Parsing ──────────────────────────────────────────────────────────

/**
 * Parse and validate pagination query parameters from request.
 *
 * @param req - Express request object
 * @param config - Pagination configuration
 * @returns Parsed and validated pagination query
 */
export function parsePaginationQuery(
  req: Request,
  config: Partial<PaginationConfig> = {}
): PaginationQuery {
  const mergedConfig = { ...DEFAULT_PAGINATION_CONFIG, ...config };
  const query: PaginationQuery = {};

  // Parse limit
  if (req.query.limit !== undefined) {
    const limit = parseInt(req.query.limit as string, 10);
    if (!isNaN(limit) && limit > 0) {
      query.limit = Math.min(limit, mergedConfig.maxLimit);
    }
  }
  query.limit = query.limit || mergedConfig.defaultLimit;

  // Parse cursor (opaque string, no validation needed)
  if (req.query.cursor !== undefined && typeof req.query.cursor === 'string') {
    query.cursor = req.query.cursor;
  }

  // Parse page (1-based, clamped to 1..maxPage — Issue #1430)
  if (req.query.page !== undefined) {
    const page = parseInt(req.query.page as string, 10);
    if (!isNaN(page) && page > 0) {
      query.page = Math.min(page, mergedConfig.maxPage);
    } else {
      query.page = 1;
    }
  }

  // Parse sortBy
  if (req.query.sortBy !== undefined && typeof req.query.sortBy === 'string') {
    query.sortBy = req.query.sortBy;
  } else if (mergedConfig.defaultSortBy) {
    query.sortBy = mergedConfig.defaultSortBy;
  }

  // Parse sortOrder
  if (req.query.sortOrder !== undefined) {
    const order = (req.query.sortOrder as string).toLowerCase();
    if (order === 'asc' || order === 'desc') {
      query.sortOrder = order;
    }
  }
  query.sortOrder = query.sortOrder || mergedConfig.defaultSortOrder;

  return query;
}

// ─── Pagination Helpers ─────────────────────────────────────────────────────

/**
 * Apply cursor-based pagination to an array of items.
 *
 * @param items - Array of items to paginate
 * @param query - Pagination query parameters
 * @param getCursor - Function to extract cursor from an item
 * @returns Paginated result with metadata
 */
export function paginateWithCursor<T>(
  items: T[],
  query: PaginationQuery,
  getCursor: (item: T) => string
): { data: T[]; pagination: PaginationMeta } {
  const limit = query.limit || DEFAULT_PAGINATION_CONFIG.defaultLimit;
  let startIndex = 0;
  const invalidCursor = false;

  if (query.page && query.page > 0) {
    startIndex = (query.page - 1) * limit;
  }

  // Find starting position based on cursor
  if (query.cursor) {
    const cursorIndex = items.findIndex((item) => getCursor(item) === query.cursor);
    if (cursorIndex === -1) {
      return {
        data: [],
        pagination: createPaginationEnvelope({
          count: 0,
          limit,
          total: query.page ? items.length : null,
          hasNextPage: false,
          hasPrevPage: false,
          currentPage: query.page ? Math.max(1, query.page) : null,
          totalPages: query.page ? Math.max(1, Math.ceil(items.length / limit)) : null,
        }),
      };
    }

    startIndex = cursorIndex + 1;
  }

  if (invalidCursor) {
    return {
      data: [],
      pagination: createPaginationEnvelope({
        count: 0,
        limit,
        total: items.length,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    };
  }

  // Extract page items
  const pageItems = items.slice(startIndex, startIndex + limit + 1);
  const hasMore = pageItems.length > limit;
  const data = hasMore ? pageItems.slice(0, limit) : pageItems;

  // Build pagination metadata
  const pagination: PaginationMeta = createPaginationEnvelope({
    count: data.length,
    limit,
    total: items.length,
    hasNextPage: hasMore,
    hasPrevPage: startIndex > 0,
    currentPage: query.page || null,
    totalPages: query.page ? Math.max(1, Math.ceil(items.length / limit)) : null,
  });

  if (hasMore && data.length > 0) {
    pagination.nextCursor = getCursor(data[data.length - 1]);
  }

  if (startIndex > 0 && data.length > 0) {
    // Find previous cursor by looking at items before current page
    const prevIndex = Math.max(0, startIndex - limit - 1);
    if (prevIndex < items.length) {
      pagination.prevCursor = getCursor(items[prevIndex]);
    }
  }

  return { data, pagination };
}

/**
 * Apply offset-based pagination to an array of items.
 *
 * @param items - Array of items to paginate
 * @param query - Pagination query parameters
 * @returns Paginated result with metadata
 */
export function paginateWithOffset<T>(
  items: T[],
  query: PaginationQuery
): { data: T[]; pagination: PaginationMeta } {
  const limit = query.limit || DEFAULT_PAGINATION_CONFIG.defaultLimit;
  const page = query.page || 1;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  const data = items.slice(startIndex, endIndex);
  const totalPages = Math.ceil(items.length / limit);

  const pagination: PaginationMeta = createPaginationEnvelope({
    count: data.length,
    limit,
    total: items.length,
    currentPage: page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  });

  return { data, pagination };
}

/**
 * Sort items by a specified field.
 *
 * @param items - Array of items to sort
 * @param sortBy - Field name to sort by
 * @param sortOrder - Sort direction
 * @returns Sorted array
 */
export function sortItems<T extends Record<string, unknown>>(
  items: T[],
  sortBy: string,
  sortOrder: 'asc' | 'desc',
  secondarySortBy: string[] = []
): T[] {
  const keys = [sortBy, ...secondarySortBy.filter((key) => key !== sortBy)];

  const compareValues = (aValue: unknown, bValue: unknown): number => {
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return aValue.localeCompare(bValue);
    }
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return aValue - bValue;
    }
    if (aValue instanceof Date && bValue instanceof Date) {
      return aValue.getTime() - bValue.getTime();
    }

    return String(aValue).localeCompare(String(bValue));
  };

  return [...items].sort((a, b) => {
    for (const key of keys) {
      const comparison = compareValues(a[key], b[key]);
      if (comparison !== 0) {
        return sortOrder === 'asc' ? comparison : -comparison;
      }
    }

    // Final deterministic fallback keeps ordering stable even when all configured keys match.
    const idComparison = compareValues(a.id, b.id);
    if (idComparison !== 0) {
      return sortOrder === 'asc' ? idComparison : -idComparison;
    }

    return compareValues(JSON.stringify(a), JSON.stringify(b));
  });
}

// ─── Response Helpers ───────────────────────────────────────────────────────

/**
 * Create a standardized paginated response.
 *
 * @param data - Array of data items
 * @param pagination - Pagination metadata
 * @returns Formatted paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  pagination: PaginationMeta,
  extras: Pick<PaginatedResponse<T>, 'normalizedDateRange'> = {}
): PaginatedResponse<T> {
  return {
    data,
    pagination,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

export function createPaginationEnvelope(meta: {
  count: number;
  limit: number;
  total?: number | null;
  nextCursor?: string | null;
  prevCursor?: string | null;
  currentPage?: number | null;
  totalPages?: number | null;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}): PaginationMeta {
  return {
    count: meta.count,
    limit: meta.limit,
    total: meta.total ?? null,
    nextCursor: meta.nextCursor ?? null,
    prevCursor: meta.prevCursor ?? null,
    currentPage: meta.currentPage ?? null,
    totalPages: meta.totalPages ?? null,
    hasNextPage: meta.hasNextPage,
    hasPrevPage: meta.hasPrevPage,
  };
}

/**
 * Send a paginated JSON response.
 *
 * @param res - Express response object
 * @param data - Array of data items
 * @param pagination - Pagination metadata
 * @param statusCode - HTTP status code (default: 200)
 */
export function sendPaginatedResponse<T>(
  res: Response,
  data: T[],
  pagination: PaginationMeta,
  statusCode: number = 200
): void {
  res.status(statusCode).json(createPaginatedResponse(data, pagination));
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Middleware to parse and attach pagination query to request.
 *
 * @param config - Pagination configuration
 * @returns Express middleware function
 */
export function paginationMiddleware(config: Partial<PaginationConfig> = {}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { pagination: PaginationQuery }).pagination = parsePaginationQuery(
      req,
      config
    );
    next();
  };
}

// ─── Cursor Encoding/Decoding ───────────────────────────────────────────────

/**
 * Encode a cursor value to a URL-safe base64 string.
 *
 * @param value - Value to encode
 * @returns Encoded cursor string
 */
export function encodeCursor(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Decode a cursor value from a URL-safe base64 string.
 *
 * @param cursor - Encoded cursor string
 * @returns Decoded cursor value
 */
export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf-8');
}

// ─── Composite Cursor Helpers ───────────────────────────────────────────────

/**
 * Build a composite cursor from a timestamp and id.
 *
 * Format: `<timestamp>_<id>` (timestamp is ISO-8601; id is the row id).
 * This matches the `?cursor=<timestamp>_<id>` contract used by list endpoints
 * that need stable keyset pagination across inserts.
 *
 * @param timestamp - Sort timestamp (Date or ISO string)
 * @param id - Row identifier
 * @returns Composite cursor string
 */
export function buildCursor(timestamp: Date | string, id: string | number): string {
  const ts = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
  return `${ts}${CURSOR_SEPARATOR}${id}`;
}

/**
 * Parse a composite cursor of the form `<timestamp>_<id>`.
 *
 * Returns `null` when the cursor is malformed so callers can fall back to
 * offset pagination or return an empty page.
 *
 * @param cursor - Composite cursor string
 * @returns Parsed `{ timestamp, id }` or null when invalid
 */
export function parseCursor(
  cursor: string
): { timestamp: Date; id: string } | null {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    return null;
  }

  const separatorIndex = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === cursor.length - 1) {
    return null;
  }

  const rawTimestamp = cursor.slice(0, separatorIndex);
  const rawId = cursor.slice(separatorIndex + 1);
  const timestamp = new Date(rawTimestamp);

  if (Number.isNaN(timestamp.getTime()) || rawId.length === 0) {
    return null;
  }

  return { timestamp, id: rawId };
}

/**
 * Build the Prisma `where` clause for keyset pagination on `(timestamp, id)`.
 *
 * Rows strictly "after" the cursor in descending `(timestamp, id)` order are
 * those with an older timestamp, or the same timestamp and a smaller id.
 *
 * @param cursor - Composite cursor string
 * @returns Prisma where fragment, or `{}` when the cursor is invalid/absent
 */
export function buildCursorWhere(
  cursor: string | undefined
): Record<string, unknown> {
  if (!cursor) {
    return {};
  }

  const parsed = parseCursor(cursor);
  if (!parsed) {
    return {};
  }

  return {
    OR: [
      { timestamp: { lt: parsed.timestamp } },
      { timestamp: parsed.timestamp, id: { lt: parsed.id } },
    ],
  };
}

/**
 * Build the Prisma `orderBy` clause for stable keyset pagination.
 *
 * Uses `(timestamp desc, id desc)` so that the cursor tuple is unique even
 * when multiple rows share the same timestamp.
 *
 * @returns Prisma orderBy array
 */
export function buildCursorOrderBy(): Array<Record<string, 'desc'>> {
  return [{ timestamp: 'desc' }, { id: 'desc' }];
}

/**
 * Extract the `nextCursor` value from the last item of a page.
 *
 * @param items - Page items (already ordered by `(timestamp desc, id desc)`)
 * @param hasMore - Whether additional rows exist beyond this page
 * @returns Composite cursor string or null
 */
export function nextCursorFromItems<
  T extends { timestamp: Date | string; id: string | number }
>(items: T[], hasMore: boolean): string | null {
  if (!hasMore || items.length === 0) {
    return null;
  }
  const last = items[items.length - 1];
  return buildCursor(last.timestamp, last.id);
}
