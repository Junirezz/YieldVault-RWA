import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      authApiKeyHash?: string;
    }
  }
}

interface ApiKeyMetadata {
  createdAt: Date;
  rotatedAt?: Date;
}

const API_KEYS = new Map<string, ApiKeyMetadata>(); // hash -> key metadata

export function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.get?.('Authorization') || '';
  const match = authHeader.match(/^ApiKey\s+(.+)$/);

  if (!match) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid API key',
    });
    return;
  }

  const providedKey = match[1];
  const hash = hashApiKey(providedKey);

  if (!API_KEYS.has(hash)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
    return;
  }

  req.authApiKeyHash = hash;

  next();
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function registerApiKey(key: string): string {
  const hash = hashApiKey(key);
  API_KEYS.set(hash, { createdAt: new Date() });
  return hash;
}

export function revokeApiKey(hash: string): boolean {
  return API_KEYS.delete(hash);
}

export function rotateApiKey(oldHash: string, newKey: string): string | null {
  const metadata = API_KEYS.get(oldHash);
  if (!metadata) {
    return null;
  }

  API_KEYS.delete(oldHash);

  const newHash = hashApiKey(newKey);
  API_KEYS.set(newHash, {
    createdAt: metadata.createdAt,
    rotatedAt: new Date(),
  });

  return newHash;
}
