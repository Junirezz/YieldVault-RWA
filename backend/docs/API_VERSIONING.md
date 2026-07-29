# API Version Negotiation & Deprecation Headers

YieldVault uses a header-based API versioning strategy. All API responses carry version information, and clients may explicitly negotiate a version on every request. Legacy unversioned routes emit RFC 8594-compliant deprecation headers to guide consumers toward the canonical `/api/v1/` surface.

---

## Version negotiation

### Supported versions

| Version | Status  |
|---------|---------|
| `1.0.0` | Current |

### How to request a version

Three mechanisms are supported, evaluated in priority order (highest first):

| Priority | Mechanism | Example |
|----------|-----------|---------|
| 1 | `X-API-Version` request header | `X-API-Version: 1.0.0` |
| 2 | `Accept-Version` request header | `Accept-Version: 1.0.0` |
| 3 | `version` parameter in `Accept` media-type | `Accept: application/json;version=1.0.0` |

Accepted version strings for the current release:

- `1` — short form
- `v1` — prefixed alias
- `1.0.0` — exact semver
- `1.x.y` — any minor/patch variant (forward-compatible with future 1.x releases)

Omitting the version header defaults the request to the current version (`1.0.0`).

### Response headers on every request

Every response — regardless of whether a version was requested — includes:

| Header | Value | Description |
|--------|-------|-------------|
| `X-API-Version` | `1.0.0` | The version that processed the request |
| `X-API-Version-Supported` | `1.0.0` | Comma-separated list of all supported versions |

### Unsupported version — 406 Not Acceptable

When the client requests a version string that does not match any supported version, the middleware **short-circuits** and returns `406 Not Acceptable` before any route handler runs:

```http
HTTP/1.1 406 Not Acceptable
X-API-Version-Supported: 1.0.0
Content-Type: application/json

{
  "error": "Not Acceptable",
  "status": 406,
  "message": "The requested API version '2.0.0' is not supported. Supported versions: 1.0.0",
  "supportedVersions": ["1.0.0"]
}
```

---

## Deprecation headers (RFC 8594 / RFC 5988)

The following route prefixes are on the **legacy unversioned API surface**:

| Legacy path prefix | Canonical successor |
|--------------------|---------------------|
| `/vault/*`         | `/api/v1/vault/*`   |
| `/referrals/*`     | `/api/v1/referrals/*` |
| `/transactions/*`  | `/api/v1/transactions/*` |
| `/portfolio/*`     | `/api/v1/portfolio/*` |
| `/api/*` (non-`/api/v1/`) | `/api/v1/*` |

Every response from a deprecated path includes:

| Header | Value | Standard |
|--------|-------|----------|
| `Deprecation` | `true` | [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594) |
| `Sunset` | `Fri, 31 Dec 2027 23:59:59 GMT` | RFC 8594 |
| `Link` | `</api/v1/…>; rel="successor-version"` | [RFC 5988](https://www.rfc-editor.org/rfc/rfc5988) |
| `X-API-Deprecation-Info` | Human-readable migration note | Non-standard informational header |

### Example response from a deprecated route

```http
GET /vault/summary HTTP/1.1

HTTP/1.1 301 Moved Permanently
Location: /api/v1/vault/summary
Deprecation: true
Sunset: Fri, 31 Dec 2027 23:59:59 GMT
Link: </api/v1/vault/summary>; rel="successor-version"
X-API-Deprecation-Info: This endpoint is deprecated. Please migrate to /api/v1/vault/summary before Fri, 31 Dec 2027 23:59:59 GMT.
X-API-Version: 1.0.0
X-API-Version-Supported: 1.0.0
```

---

## Migration guide

1. Update all base URLs from `/vault/`, `/referrals/`, `/transactions/`, `/portfolio/` to the corresponding `/api/v1/` prefix.
2. Optionally add `Accept-Version: 1.0.0` or `X-API-Version: 1.0.0` to requests for forward-compatibility signalling.
3. Handle `406 Not Acceptable` in your HTTP client to detect version mismatches early.
4. Monitor the `Sunset` header in your client logging to receive advance notice of removal dates.

---

## Middleware reference

**File:** [`backend/src/middleware/versionNegotiation.ts`](../src/middleware/versionNegotiation.ts)

**Exported symbols:**

| Symbol | Type | Description |
|--------|------|-------------|
| `apiVersionMiddleware` | `RequestHandler` | Express middleware — apply globally with `app.use(apiVersionMiddleware)` |
| `CURRENT_VERSION` | `string` | The version string set on `X-API-Version` response headers |
| `SUPPORTED_VERSIONS` | `readonly string[]` | Array of all accepted version strings |
| `LEGACY_SUNSET_DATE` | `string` | RFC 1123 date string used in `Sunset` headers |

**Applied in:** [`backend/src/index.ts`](../src/index.ts) — registered early in the middleware stack (before routing) so that all responses carry version headers.

---

## Tests

**File:** [`backend/src/__tests__/versionNegotiation.test.ts`](../src/__tests__/versionNegotiation.test.ts)

Coverage areas:

- `X-API-Version` and `X-API-Version-Supported` present on every response
- `Accept-Version` — exact version, short form (`1`), prefix alias (`v1`), semver variant (`1.x.y`)
- `X-API-Version` request header — supported, unsupported, priority over `Accept-Version`
- `Accept` media-type `version=` parameter — supported and unsupported values
- 406 response body shape (`error`, `status`, `message`, `supportedVersions`)
- Deprecation headers on `/vault/*`, `/referrals/*`, `/transactions/*`, `/portfolio/*`
- Deprecation headers on `/api/vault/*` (non-v1 legacy)
- No deprecation headers on canonical `/api/v1/*` routes
- Requests with no version header are allowed and default to the current version
