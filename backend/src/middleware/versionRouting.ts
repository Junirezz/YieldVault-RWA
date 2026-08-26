import type { NextFunction, Request, Response } from 'express';

export type ApiVersionId = 'v1' | 'v2';
export type ApiVersionSource = 'path' | 'legacy' | 'default';

export const API_V1_PREFIX = '/api/v1';
export const API_V2_PREFIX = '/api/v2';

const VERSIONED_PATH = /^\/api\/v(\d+)(?:\/|$)/;

function isLegacyUnversionedPath(path: string): boolean {
  return (
    path.startsWith('/vault') ||
    path.startsWith('/referrals') ||
    path.startsWith('/transactions') ||
    path.startsWith('/portfolio') ||
    (path.startsWith('/api/') &&
      path !== '/api/versions' &&
      !path.startsWith(API_V1_PREFIX) &&
      !path.startsWith(API_V2_PREFIX))
  );
}

export function resolveApiVersionFromPath(path: string): {
  version: ApiVersionId;
  source: ApiVersionSource;
} {
  const match = path.match(VERSIONED_PATH);
  if (match) {
    const major = match[1];
    if (major === '2') {
      return { version: 'v2', source: 'path' };
    }
    return { version: 'v1', source: 'path' };
  }

  if (isLegacyUnversionedPath(path)) {
    return { version: 'v1', source: 'legacy' };
  }

  return { version: 'v1', source: 'default' };
}

/**
 * Version routing middleware.
 *
 * Reads the `/api/v1` or `/api/v2` prefix, attaches `req.apiVersion`, and
 * advertises the path version so later handlers and version negotiation can
 * keep clients pinned to a stable contract.
 */
export function versionRoutingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const resolved = resolveApiVersionFromPath(req.path);
  req.apiVersion = resolved.version;
  req.apiVersionSource = resolved.source;

  res.set('X-API-Version-Path', resolved.version === 'v2' ? API_V2_PREFIX : API_V1_PREFIX);

  next();
}
