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
  /** Total number of items available (if known). */
  total?: number;
  /** Cursor for the next page (if more items exist). */
  nextCursor?: string;
  /** Cursor for the previous page (if applicable). */
  prevCursor?: string;
  /** Current page number (for offset-based pagination). */
  currentPage?: number;
  /** Total number of pages (if total is known). */
  totalPages?: number;
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
}

/**
 * Configuration for pagination behavior.
 */
export interface PaginationConfig {
  /** Default number of items per page. */
  defaultLimit: number;
  /** Maximum allowed items per page. */
  maxLimit: number;
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
  includeTotal: true,
  defaultSortOrder: 'desc',
};

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

  // Parse page (1-based)
  if (req.query.page !== undefined) {
    const page = parseInt(req.query.page as string, 10);
    if (!isNaN(page) && page > 0) {
      query.page = page;
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

  // Find starting position based on cursor
  if (query.cursor) {
    const cursorIndex = items.findIndex((item) => getCursor(item) === query.cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  // Extract page items
  const pageItems = items.slice(startIndex, startIndex + limit + 1);
  const hasMore = pageItems.length > limit;
  const data = hasMore ? pageItems.slice(0, limit) : pageItems;

  // Build pagination metadata
  const pagination: PaginationMeta = {
    count: data.length,
    hasNextPage: hasMore,
    hasPrevPage: startIndex > 0,
  };

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

  const pagination: PaginationMeta = {
    count: data.length,
    total: items.length,
    currentPage: page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };

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
  sortOrder: 'asc' | 'desc'
): T[] {
  return [...items].sort((a, b) => {
    const aValue = a[sortBy];
    const bValue = b[sortBy];

    // Handle null/undefined values
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return sortOrder === 'asc' ? 1 : -1;
    if (bValue == null) return sortOrder === 'asc' ? -1 : 1;

    // Compare values
    let comparison = 0;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue);
    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
      comparison = aValue - bValue;
    } else if (aValue instanceof Date && bValue instanceof Date) {
      comparison = aValue.getTime() - bValue.getTime();
    } else {
      // Fallback to string comparison
      comparison = String(aValue).localeCompare(String(bValue));
    }

    return sortOrder === 'asc' ? comparison : -comparison;
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
  pagination: PaginationMeta
): PaginatedResponse<T> {
  return {
    data,
    pagination,
    timestamp: new Date().toISOString(),
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
    (req as Request & { pagination: PaginationQuery }).pagination = parsePaginationQuery(req, config);
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

