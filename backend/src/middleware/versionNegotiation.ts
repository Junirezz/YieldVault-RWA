import type { Request, Response, NextFunction } from 'express';

// ─── Version Configuration ────────────────────────────────────────────────────

/** The single version currently served by this API. */
export const CURRENT_VERSION = '1.0.0';
export const V2_PREVIEW_VERSION = '2.0.0-preview';

/**
 * All version strings that are accepted and mapped to the current release.
 * Any request bearing one of these values is treated as a supported request.
 */
export const SUPPORTED_VERSIONS: readonly string[] = [CURRENT_VERSION, V2_PREVIEW_VERSION];

/**
 * RFC 8594 Sunset date for the legacy unversioned API surface.
 * Consumers hitting /vault/*, /referrals/*, /transactions/*, /portfolio/*
 * without the /api/v1 prefix will receive Deprecation + Sunset headers until
 * this date, after which those paths will be removed.
 */
export const LEGACY_SUNSET_DATE = 'Fri, 31 Dec 2027 23:59:59 GMT';

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns true when `raw` resolves to one of the supported v1 version strings.
 * Accepts: "1", "v1", "1.0.0", or any "1.x.y" patch/minor variant.
 */
function isV2PreviewVersion(raw: string): boolean {
  const v = raw.trim();
  return (
    v === '2' ||
    v.toLowerCase() === 'v2' ||
    v === '2.0.0' ||
    v.toLowerCase() === V2_PREVIEW_VERSION
  );
}

function isSupportedVersion(raw: string): boolean {
  const v = raw.trim();
  return (
    v === '1' ||
    v.toLowerCase() === 'v1' ||
    SUPPORTED_VERSIONS.includes(v) ||
    /^1\.\d+(\.\d+)?$/.test(v) ||
    isV2PreviewVersion(v)
  );
}

/**
 * Extracts an explicit version request from the incoming HTTP headers.
 * Priority order (highest to lowest):
 *   1. X-API-Version request header
 *   2. Accept-Version request header
 *   3. `version` parameter inside the Accept media-type (e.g. application/json;version=1.0.0)
 */
function extractRequestedVersion(req: Request): string | null {
  const xApiVersion = req.get('X-API-Version');
  if (xApiVersion) return xApiVersion.trim();

  const acceptVersion = req.get('Accept-Version');
  if (acceptVersion) return acceptVersion.trim();

  const accept = req.get('Accept') ?? '';
  const match = accept.match(/version\s*=\s*([^;,\s]+)/i);
  if (match) return match[1].trim();

  return null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Global middleware for API version negotiation and RFC 8594 deprecation headers.
 *
 * ## Version negotiation
 * Every response carries:
 *   - `X-API-Version: 1.0.0`         — version that processed this request
 *   - `X-API-Version-Supported: 1.0.0` — comma-separated list of all supported versions
 *
 * When the client explicitly requests a version via `X-API-Version`,
 * `Accept-Version`, or an `Accept` media-type parameter and that version is
 * not in SUPPORTED_VERSIONS, the middleware short-circuits with **406 Not
 * Acceptable**.
 *
 * ## Deprecation headers (RFC 8594 / RFC 5988)
 * Routes on the legacy unversioned surface (`/vault/*`, `/referrals/*`,
 * `/transactions/*`, `/portfolio/*`) and old `/api/*` paths (not `/api/v1/`)
 * receive:
 *   - `Deprecation: true`
 *   - `Sunset: <LEGACY_SUNSET_DATE>`
 *   - `Link: </api/v1/…>; rel="successor-version"`
 *   - `X-API-Deprecation-Info: <human-readable message>`
 */
export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  // ── 1. Version negotiation ──────────────────────────────────────────────────
  const requestedVersion = extractRequestedVersion(req);
  const isPreviewRequest =
    requestedVersion !== null && isV2PreviewVersion(requestedVersion);

  if (requestedVersion !== null && !isSupportedVersion(requestedVersion)) {
    res.status(406).json({
      error: 'Not Acceptable',
      status: 406,
      message: `The requested API version '${requestedVersion}' is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
      supportedVersions: SUPPORTED_VERSIONS,
    });
    return;
  }

  // Always advertise the current version and the full supported list.
  res.set('X-API-Version', isPreviewRequest ? V2_PREVIEW_VERSION : CURRENT_VERSION);
  res.set('X-API-Version-Supported', SUPPORTED_VERSIONS.join(', '));
  if (isPreviewRequest || req.path.startsWith('/api/v2/')) {
    res.set('X-API-Preview', 'v2');
    res.set(
      'X-API-Preview-Info',
      'API v2 is a breaking-changes preview. Pin Accept-Version: 1.0.0 for stable v1 behavior.',
    );
  }

  // ── 2. Deprecation detection for legacy unversioned routes ─────────────────
  const path = req.path;

  const isLegacyUnversioned =
    path.startsWith('/vault') ||
    path.startsWith('/referrals') ||
    path.startsWith('/transactions') ||
    path.startsWith('/portfolio');

  // /api/* is legacy unless it is already a canonical versioned route.
  const isLegacyApi =
    path.startsWith('/api/') && !path.startsWith('/api/v1/') && !path.startsWith('/api/v2/');

  if (isLegacyUnversioned || isLegacyApi) {
    let successorPath: string;
    if (isLegacyApi) {
      successorPath = path.replace('/api/', '/api/v1/');
    } else {
      successorPath = `/api/v1${path}`;
    }

    res.set('Deprecation', 'true');
    res.set('Sunset', LEGACY_SUNSET_DATE);
    res.set('Link', `<${successorPath}>; rel="successor-version"`);
    res.set(
      'X-API-Deprecation-Info',
      `This endpoint is deprecated. Please migrate to ${successorPath} before ${LEGACY_SUNSET_DATE}.`,
    );
  }

  next();
}
