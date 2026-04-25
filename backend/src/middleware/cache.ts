import type { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();

export interface CacheOptions {
  ttl: number; // milliseconds
}

export function cacheMiddleware(options: CacheOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const cacheKey = `${req.method}:${req.path}`;
    const cached = responseCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('X-Cache-Hit', 'true');
      res.json(cached.data);
      return;
    }

    const originalJson = res.json.bind(res);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json = function (data: any) {
      responseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + options.ttl,
      });
      res.setHeader('X-Cache-Hit', 'false');
      res.setHeader(
        'Cache-Control',
        `public, max-age=${Math.ceil(options.ttl / 1000)}`,
      );
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
