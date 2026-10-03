/**
 * @file paginationGuard.ts
 * Hard caps for caller-controlled pagination on database-backed list routes.
 *
 * Issue #1430: `GET /vaults` forwarded `req.query.limit` straight into
 * Prisma's `take`, so an unauthenticated caller could ask for
 * `?limit=100000` and force the API to materialise 100k rows plus their
 * relations — a memory spike large enough to OOM-kill the 512 MB
 * container.
 *
 * Chosen behaviour: **reject, do not silently clamp.** A caller that asks
 * for `limit=100000` has a bug (or is probing), and quietly returning 50
 * rows hides that behind a paginated response that looks complete. So an
 * over-max `limit` fails fast with `400` and `code: 'LIMIT_EXCEEDED'`, and
 * the response body names the ceiling. `page` is different: an out-of-range
 * page number is a benign mistake, so it is clamped to `1..MAX_PAGE` and
 * the effective value is echoed back in the pagination envelope.
 *
 * Anything that turns a request parameter into a Prisma `take`/`skip`
 * should sit behind `enforcePaginationLimits()`.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendApiError } from './apiError';

/** Page size used when the caller does not ask for one. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hard ceiling on rows read per request. Sized so the largest permitted
 * page stays comfortably inside the API container's memory budget.
 */
export const MAX_PAGE_SIZE = 50;

/**
 * Hard ceiling on offset pagination depth. `page * limit` is what reaches
 * Prisma as `skip`, so an unbounded page number is an unbounded database
 * offset scan.
 */
export const MAX_PAGE = 1000;

export interface PaginationLimitOptions {
  /** Rows per page when `limit` is absent. Defaults to {@link DEFAULT_PAGE_SIZE}. */
  defaultLimit?: number;
  /** Largest permitted `limit`. Defaults to {@link MAX_PAGE_SIZE}. */
  maxLimit?: number;
  /** Largest permitted `page`. Defaults to {@link MAX_PAGE}. */
  maxPage?: number;
}

export interface ResolvedPagination {
  limit: number;
  page: number;
}

/** Error code returned for a `limit` above the configured ceiling. */
export const LIMIT_EXCEEDED_CODE = 'LIMIT_EXCEEDED';

/**
 * Parses a raw query-string value that is expected to hold a base-10
 * integer. Returns `null` for anything that is not an exact integer so
 * callers can tell "absent" from "garbage".
 */
function parseIntegerQueryValue(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) return null;
  if (typeof raw !== 'string') return null;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Resolves the effective `limit` and `page` for a request.
 *
 * Throws {@link PaginationLimitError} when `limit` exceeds the ceiling, so
 * the middleware can turn it into a `400` instead of running a query.
 */
export function resolvePagination(
  query: Record<string, unknown>,
  options: PaginationLimitOptions = {}
): ResolvedPagination {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = options.maxLimit ?? MAX_PAGE_SIZE;
  const maxPage = options.maxPage ?? MAX_PAGE;

  const rawLimit = parseIntegerQueryValue(query.limit);
  if (rawLimit !== null && rawLimit > maxLimit) {
    throw new PaginationLimitError(rawLimit, maxLimit);
  }

  const limit =
    rawLimit !== null && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;

  const rawPage = parseIntegerQueryValue(query.page);
  const page =
    rawPage === null || rawPage < 1 ? 1 : Math.min(rawPage, maxPage);

  return { limit, page };
}

/** Thrown when a caller asks for more rows per page than the route allows. */
export class PaginationLimitError extends Error {
  readonly requested: number;
  readonly maxLimit: number;

  constructor(requested: number, maxLimit: number) {
    super(
      `limit must not exceed ${maxLimit} (received ${requested}). ` +
        'Request at most ' +
        `${maxLimit} items per page and use the page/cursor parameters to walk the rest of the collection.`,
    );
    this.name = 'PaginationLimitError';
    this.requested = requested;
    this.maxLimit = maxLimit;
  }
}

/**
 * Express middleware that rejects an over-max `limit` with
 * `400` / `code: 'LIMIT_EXCEEDED'` before any database work happens, and
 * pins the sanitised `limit`/`page` onto `req.resolvedPagination` for the
 * handler.
 */
export function enforcePaginationLimits(options: PaginationLimitOptions = {}) {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = options.maxLimit ?? MAX_PAGE_SIZE;
  const maxPage = options.maxPage ?? MAX_PAGE;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const resolved = resolvePagination(req.query as Record<string, unknown>, {
        defaultLimit,
        maxLimit,
        maxPage,
      });

      req.resolvedPagination = resolved;
      next();
    } catch (err) {
      if (err instanceof PaginationLimitError) {
        sendApiError(req, res, {
          status: 400,
          code: LIMIT_EXCEEDED_CODE,
          message: err.message,
          retryable: false,
          details: {
            field: 'limit',
            requested: err.requested,
            maxLimit: err.maxLimit,
            defaultLimit,
            maxPage,
          },
        });
        return;
      }
      next(err);
    }
  };
}
