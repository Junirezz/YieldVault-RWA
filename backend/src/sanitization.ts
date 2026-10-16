import { Request, Response, NextFunction } from 'express';
import { StrKey } from '@stellar/stellar-base';
import { sendApiError } from './middleware/apiError';

const MAX_SAFE_NUMBER = Number.MAX_SAFE_INTEGER;
const MIN_SAFE_NUMBER = Number.MIN_SAFE_INTEGER;

/**
 * Returns true only for canonical Stellar G-addresses (ED25519 public keys).
 * Rejects muxed M-addresses, federation aliases, and anything with a bad checksum.
 */
export function isValidStellarAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * Middleware to sanitize incoming request bodies.
 * 
 * 1. Strips prototype pollution vectors and NoSQL injection vectors.
 * 2. Validates that all numeric parameters are within safe ranges.
 */
export const sanitizationMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.body || typeof req.body !== 'object') {
    next();
    return;
  }

  try {
    sanitizeObject(req.body);
    next();
  } catch (error: unknown) {
    sendApiError(req, res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: error instanceof Error ? error.message : 'Invalid input parameters detected',
    });
  }
};

function sanitizeObject(obj: any): void {
  if (obj === null || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'number') {
        validateNumber(obj[i]);
      } else if (typeof obj[i] === 'object') {
        sanitizeObject(obj[i]);
      }
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    // Strip unexpected/malicious fields
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || key.startsWith('$')) {
      delete obj[key];
      continue;
    }

    const value = obj[key];
    
    // Validate numeric parameters
    if (typeof value === 'number') {
      validateNumber(value);
    } else if (typeof value === 'object') {
      sanitizeObject(value);
    }
  }
}

function validateNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error('Numeric parameter must be finite');
  }
  if (value > MAX_SAFE_NUMBER || value < MIN_SAFE_NUMBER) {
    throw new Error('Numeric parameter is out of acceptable range');
  }
}
