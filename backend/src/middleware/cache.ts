import type { Request, Response, NextFunction } from 'express';
import { cacheHitCount, cacheMissCount } from '../metrics';

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();

export interface CacheOptions {
  ttl: number; // milliseconds
}

function normalizeCacheKey(req: Request): string {
  const baseKey = `${req.method}:${req.path}`;
  const queryEntries = Object.entries(req.query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) =>
      Array.isArray(value)
        ? `${key}=${value.slice().sort().join(',')}`
        : `${key}=${value}`,
    );

  return queryEntries.length ? `${baseKey}?${queryEntries.join('&')}` : baseKey;
}

export function cacheMiddleware(options: CacheOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const cacheKey = normalizeCacheKey(req);
    const cached = responseCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('X-Cache-Hit', 'true');
      cacheHitCount.inc({ method: req.method, route: req.path });
      res.json(cached.data);
      return;
    }

    const originalJson = res.json.bind(res);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json = function (data: any) {
      const successResponse = res.statusCode >= 200 && res.statusCode < 300;
      if (successResponse) {
        responseCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + options.ttl,
        });
        cacheMissCount.inc({ method: req.method, route: req.path });
        res.setHeader(
          'Cache-Control',
          `public, max-age=${Math.ceil(options.ttl / 1000)}`,
        );
        res.setHeader('X-Cache-Hit', 'false');
      }
      return originalJson(data);
    } as typeof res.json;

    next();
  };
}

export function invalidateCache(pattern?: string): void {
  if (!pattern) {
    responseCache.clear();
    return;
  }

  const regex = new RegExp(pattern);
  for (const key of responseCache.keys()) {
    if (regex.test(key)) {
      responseCache.delete(key);
    }
  }
}

export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: responseCache.size,
    entries: Array.from(responseCache.keys()),
  };
}
