/**
 * @file middleware/geofencing.ts
 * IP-based geofencing to block restricted jurisdictions (Issue #379).
 *
 * Returns HTTP 451 Unavailable For Legal Reasons for requests originating
 * from countries on the configured blocklist.
 *
 * Architecture notes (as required by the acceptance criteria):
 * ─────────────────────────────────────────────────────────────
 * GeoIP provider:
 *   The `GeoIpProvider` interface decouples the middleware from any specific
 *   GeoIP library. The default `EnvGeoIpProvider` resolves IPs using the
 *   GEOIP_COUNTRY_MAP environment variable (JSON map) or the bundled
 *   `geoip-lite` library when installed.  In production, swap the provider
 *   for MaxMind GeoIP2 or a cloud geolocation API by implementing the interface.
 *
 * VPN / proxy detection:
 *   Out of scope for this issue (noted in architecture per acceptance criteria).
 *   When needed, add a second provider (e.g. ipqualityscore, ipinfo proxy flag)
 *   and chain it after the country check.
 *
 * Blocklist configuration:
 *   GEOIP_BLOCKED_COUNTRIES – comma-separated ISO-3166-1 alpha-2 codes (e.g. US,CN,RU)
 *   Loaded from environment on every request so the list can be updated without
 *   a code deployment (file-watch approach can replace this for high-throughput).
 *
 * Feature flag:
 *   GEOIP_ENABLED – set to "false" to bypass geofencing entirely (default: "true").
 *
 * Environment variables:
 *   GEOIP_ENABLED            – "false" disables all geofencing
 *   GEOIP_BLOCKED_COUNTRIES  – comma-separated country codes to block
 *   GEOIP_COUNTRY_MAP        – JSON string {"IP":"CC",...} for testing / seedfallback
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './structuredLogging';

// ─── GeoIP Provider Interface ─────────────────────────────────────────────────

/**
 * Abstraction over any GeoIP lookup library.
 * Returns the ISO-3166-1 alpha-2 country code for a given IP, or null when
 * the IP cannot be resolved (private ranges, parse errors, etc.).
 */
export interface GeoIpProvider {
  lookup(ip: string): string | null;
}

// ─── Default Provider ─────────────────────────────────────────────────────────

/**
 * EnvGeoIpProvider:
 *   1. Tries to require `geoip-lite` (optional peer dependency).
 *   2. Falls back to the GEOIP_COUNTRY_MAP env var (JSON map {"IP":"CC"}).
 *   3. Returns null when neither is available (fail-open for unresolved IPs).
 *
 * This allows the middleware to work without installing geoip-lite while
 * still being testable via environment variable injection.
 */
export class EnvGeoIpProvider implements GeoIpProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private geoipLite: any | null;

  constructor() {
    try {
      // Attempt to load geoip-lite if installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.geoipLite = require('geoip-lite');
    } catch {
      this.geoipLite = null;
    }
  }

  lookup(ip: string): string | null {
    // 1. Try geoip-lite (bundled MaxMind DB)
    if (this.geoipLite) {
      const result = this.geoipLite.lookup(ip);
      return result?.country ?? null;
    }

    // 2. Try GEOIP_COUNTRY_MAP env var (for testing / seed data)
    const mapRaw = process.env.GEOIP_COUNTRY_MAP;
    if (mapRaw) {
      try {
        const map = JSON.parse(mapRaw) as Record<string, string>;
        return map[ip] ?? null;
      } catch {
        // Invalid JSON – ignore
      }
    }

    // 3. Cannot resolve – fail-open (do not block unknown IPs)
    return null;
  }
}

/** Singleton default provider. Can be replaced in tests via setGeoIpProvider(). */
let activeProvider: GeoIpProvider = new EnvGeoIpProvider();

/** Replaces the active GeoIP provider (useful for unit tests / dependency injection). */
export function setGeoIpProvider(provider: GeoIpProvider): void {
  activeProvider = provider;
}

/** Resets the provider to the default EnvGeoIpProvider. */
export function resetGeoIpProvider(): void {
  activeProvider = new EnvGeoIpProvider();
}

// ─── Blocklist Loader ─────────────────────────────────────────────────────────

/**
 * Reads the blocklist from GEOIP_BLOCKED_COUNTRIES on every call so that
 * operators can update it without a code deployment.
 */
export function loadBlocklist(): Set<string> {
  const raw = process.env.GEOIP_BLOCKED_COUNTRIES || '';
  const codes = raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length === 2); // valid ISO-3166-1 alpha-2 codes only
  return new Set(codes);
}

// ─── IP Extraction ────────────────────────────────────────────────────────────

/**
 * Extracts the real client IP from the request.
 * Respects X-Forwarded-For when behind a trusted reverse proxy.
 */
export function extractClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim() || null;
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that blocks requests from restricted jurisdictions.
 *
 * - Returns 451 Unavailable For Legal Reasons for blocked countries.
 * - Passes through when GEOIP_ENABLED=false, IP is unresolvable, or country is not blocked.
 * - VPN/proxy detection is out of scope (noted per issue requirements).
 */
export function geofencingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Feature flag
  if (process.env.GEOIP_ENABLED === 'false') {
    next();
    return;
  }

  const blocklist = loadBlocklist();

  // No blocklist configured → nothing to block
  if (blocklist.size === 0) {
    next();
    return;
  }

  const ip = extractClientIp(req);

  if (!ip) {
    // Cannot determine IP → fail-open
    logger.log('warn', 'Geofencing: could not determine client IP, allowing request');
    next();
    return;
  }

  const country = activeProvider.lookup(ip);

  if (!country) {
    // IP could not be resolved to a country → fail-open (unresolved IPs pass through)
    next();
    return;
  }

  if (blocklist.has(country)) {
    logger.log('warn', 'Geofencing: request blocked from restricted jurisdiction', {
      country,
      path: req.path,
    });
    res.status(451).json({
      error: 'Unavailable For Legal Reasons',
      status: 451,
      message:
        `Access to YieldVault is not available in your jurisdiction (${country}). ` +
        'This restriction is required by applicable regulations. ' +
        'If you believe this is an error, please contact support@yieldvault.finance.',
      country,
      // Note: VPN/proxy detection is not implemented (out of scope, see architecture docs)
    });
    return;
  }

  next();
}
