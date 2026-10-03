declare global {
  import type { ResolvedPagination } from '../middleware/paginationGuard';

  namespace Express {
    interface Request {
      authApiKeyHash?: string;
      authApiKeyRole?: string;
      apiVersion?: 'v1' | 'v2';
      apiVersionSource?: 'path' | 'legacy' | 'default';
      /**
       * Effective, clamped pagination parameters for the current request.
       * Populated by `enforcePaginationLimits()`.
       */
      resolvedPagination?: ResolvedPagination;
    }
  }
}

export {};
