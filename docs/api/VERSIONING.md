# API Versioning and Deprecation Policy

This document defines how YieldVault versions its REST API, when and how deprecated
endpoints are retired, and what integrators should do to stay compatible.

For error shapes during migration, see [ERROR_CODE_CATALOG.md](./ERROR_CODE_CATALOG.md).
For pagination changes across versions, see [PAGINATION.md](./PAGINATION.md).

---

## Table of contents

1. [Versioning scheme](#1-versioning-scheme)
2. [Current and supported versions](#2-current-and-supported-versions)
3. [How versions are communicated](#3-how-versions-are-communicated)
4. [Deprecation policy](#4-deprecation-policy)
5. [Deprecation signals](#5-deprecation-signals)
6. [Backward-compatibility redirects](#6-backward-compatibility-redirects)
7. [What constitutes a breaking change](#7-what-constitutes-a-breaking-change)
8. [Non-breaking changes (safe to ship without a new version)](#8-non-breaking-changes-safe-to-ship-without-a-new-version)
9. [Client migration guide](#9-client-migration-guide)
10. [Version lifecycle stages](#10-version-lifecycle-stages)
11. [FAQ](#11-faq)

---

## 1. Versioning scheme

YieldVault uses **URL path versioning** for the REST API:

```
https://<host>/api/<version>/<resource>
```

| Component | Example | Notes |
|-----------|---------|-------|
| `<host>` | `api.yieldvault.io` | Varies by environment |
| `<version>` | `v1` | Integer-incremented: `v1`, `v2`, … |
| `<resource>` | `vault/summary` | Stable resource path within a version |

A full versioned endpoint looks like:

```
GET https://api.yieldvault.io/api/v1/vault/summary
```

### Why URL versioning?

URL versioning was chosen because:

- It is visible in access logs without parsing headers.
- Proxies, CDNs, and caches route on the path without special configuration.
- Testing in a browser or with `curl` requires no extra headers.

**Header-based versioning** (`Accept: application/vnd.yieldvault.v2+json`) is not
currently supported. Custom `X-API-Version` request headers are also ignored.

---

## 2. Current and supported versions

| Version | Status | Base path | Introduced | End-of-life |
|---------|--------|-----------|------------|-------------|
| **v1** | **Active** (current) | `/api/v1` | 2026-03-28 | TBD |
| **v2** | **Preview** (breaking-change preview) | `/api/v2` | 2026-08-25 | TBD |

New production integrations must use the `v1` base path. `v2` is available as a
preview for endpoints that are being reshaped before the next major API release.
Preview responses include `X-API-Preview: v2` and may change before v2 becomes
active.

**Unversioned paths** (e.g., `/api/vault/summary`, `/auth/login`) are a legacy
transition layer that **redirects 301** to the `v1` equivalents. They are
subject to removal without a separate deprecation window once the transition
window closes (see [§ 6](#6-backward-compatibility-redirects)).

---

## 3. How versions are communicated

Every response from the API includes an `X-API-Version` response header
indicating the version contract that handled the request:

```
X-API-Version: 1.0.0
X-API-Version-Supported: 1.0.0, 2.0.0-preview
```

This header is always present on `2xx`, `4xx`, and `5xx` responses. It is absent
only on infrastructure-level rejections (load balancer, TLS handshake failures)
that never reach the application server.

Integrators should log this header alongside `X-Correlation-ID` to aid in
debugging cross-version issues during migration periods.

Clients can pin a version with `X-API-Version`, `Accept-Version`, or an
`Accept` media type parameter such as `application/json;version=1.0.0`. The
server accepts `1`, `v1`, `1.0.0`, and compatible `1.x` values for stable v1.
It accepts `2`, `v2`, `2.0.0`, and `2.0.0-preview` for the v2 preview. Unknown
versions return `406 Not Acceptable` with the supported version list.

The first v2 preview route is:

```
GET /api/v2/vaults/:id/health
```

It currently redirects with `307` to the stable v1 health handler:

```
GET /api/v1/vaults/:id/health
```

That v1 handler returns vault status, process uptime, dependency health, vault
summary metrics, and a `cached` flag. Responses are cached for five seconds and
use the read-tier rate limiter so monitoring systems can poll it safely.

---

## 4. Deprecation policy

### 4.1 Deprecation windows by change type

| Change type | Minimum notice | Minimum availability after notice |
|-------------|---------------|----------------------------------|
| Non-critical endpoint removal | 90 days | 90 days |
| Critical endpoint removal (auth, deposits, withdrawals) | 180 days | 180 days |
| Request field removal or rename | 90 days | 90 days |
| Response field removal or rename | 90 days | 90 days |
| Behavior change with backward-compatible fallback | 60 days | 60 days |
| Full version sunset (e.g., retiring `v1`) | 12 months | 12 months |

> **Emergency security deprecations** bypass the standard window. If a deprecated
> endpoint poses an active security risk (e.g., an exploitable authentication bypass),
> it may be disabled with as little as **7 days' notice** (or immediately, if
> exploitation is confirmed). A post-mortem and migration path will be published
> within 48 hours of any emergency removal.

### 4.2 Deprecation announcement channels

When an endpoint or field is deprecated, the following channels will carry the
announcement before the removal date:

1. **GitHub release notes** — deprecation listed under `### Deprecated` in the
   relevant `CHANGELOG.md` entry.
2. **Response headers** — `Deprecation` and `Sunset` headers added to every
   response from the affected endpoint (see [§ 5](#5-deprecation-signals)).
3. **API documentation** — this document and the relevant endpoint doc are updated
   with a deprecation notice, the sunset date, and a migration path.
4. **Email notification** — integrators with registered API keys receive an email
   to the address on file at least 30 days before the sunset date.

### 4.3 What happens on the sunset date

On the sunset date the deprecated endpoint responds with `410 Gone`:

```json
{
  "error": "Gone",
  "status": 410,
  "message": "This endpoint was sunset on <ISO date>. Migrate to <replacement path>.",
  "migrateToPath": "/api/v1/<replacement>"
}
```

The `410` response is served for a **30-day grace window** after the announced
sunset date to help clients that missed the deadline. After the grace window, the
route is removed and unknown paths return the standard `404 Not Found`.

---

## 5. Deprecation signals

### 5.1 `Deprecation` header

The `Deprecation` header follows
[RFC 8594](https://www.rfc-editor.org/rfc/rfc8594) and is set on every response
from a deprecated endpoint:

```
Deprecation: Sat, 30 Sep 2026 00:00:00 GMT
```

The date is the **sunset date** — the day the endpoint stops accepting requests.

When an endpoint is deprecated indefinitely (no sunset date yet confirmed),
the header carries the boolean form:

```
Deprecation: true
```

### 5.2 `Sunset` header

The `Sunset` header (also [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594))
carries the same date as `Deprecation` when a firm sunset date is set:

```
Sunset: Sat, 30 Sep 2026 00:00:00 GMT
```

### 5.3 `Link` header (migration hint)

A `Link` header pointing to the replacement endpoint and this policy document is
added alongside the deprecation headers:

```
Link: </api/v1/vault/summary>; rel="successor-version",
      </docs/api/VERSIONING.md>; rel="deprecation"
```

### 5.4 Example: full deprecation response headers

```
HTTP/1.1 200 OK
X-API-Version: v1
Deprecation: Sat, 30 Sep 2026 00:00:00 GMT
Sunset: Sat, 30 Sep 2026 00:00:00 GMT
Link: </api/v1/vault/summary>; rel="successor-version", </docs/api/VERSIONING.md>; rel="deprecation"
X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000
```

Integrators should monitor for the presence of the `Deprecation` header and alert
their teams when it appears on a response.

---

## 6. Backward-compatibility redirects

During the initial migration from unversioned to versioned paths, the server issues
**`301 Moved Permanently`** redirects from legacy paths to their `v1` equivalents.

| Legacy path (deprecated) | Canonical path | Notes |
|--------------------------|---------------|-------|
| `POST /auth/login` | `POST /api/v1/auth/login` | — |
| `POST /auth/refresh` | `POST /api/v1/auth/refresh` | — |
| `POST /auth/logout` | `POST /api/v1/auth/logout` | — |
| `POST /auth/logout-all` | `POST /api/v1/auth/logout-all` | — |
| `GET /api/vault/summary` | `GET /api/v1/vault/summary` | `Deprecation: true` set |
| `GET /api/vault/metrics` | `GET /api/v1/vault/metrics` | — |
| `GET /api/vault/apy` | `GET /api/v1/vault/apy` | — |
| `GET /api/vault/transactions/export` | `GET /api/v1/vault/transactions/export` | — |
| `POST /webhooks/verify` | `POST /api/v1/webhooks/verify` | — |
| `GET/POST /vault/*` | `/api/v1/vault/*` | Catch-all redirect |
| `GET/POST /referrals/*` | `/api/v1/referrals/*` | Catch-all redirect |
| `GET/POST /transactions/*` | `/api/v1/transactions/*` | Catch-all redirect |
| `GET/POST /portfolio/*` | `/api/v1/portfolio/*` | Catch-all redirect |

### Redirect behavior notes

- HTTP clients that follow redirects automatically (most HTTP libraries) will reach
  the canonical endpoint transparently. The `301` status signals that clients
  **must update their stored URLs** — the redirect is not permanent infrastructure.
- `POST` redirects: some HTTP clients downgrade `POST` to `GET` on a `301`. If you
  experience unexpected `GET` requests reaching the versioned endpoint, use
  `307 Temporary Redirect` semantics by updating your base URL instead.
- The redirect layer will be removed once the transition window closes (no earlier
  than **90 days** after the first `Deprecation` header appears on those paths).
  Clients relying on redirects will start receiving `404 Not Found` at that point.

---

## 7. What constitutes a breaking change

A breaking change requires a new API version. The following are always breaking:

| Category | Examples |
|----------|---------|
| Removing an endpoint | Deleting `GET /api/v1/vault/summary` |
| Renaming an endpoint | `/api/v1/vault/metrics` → `/api/v1/vault/stats` |
| Removing a required or optional request field | Removing `walletAddress` from transaction filters |
| Removing a response field that was previously always present | Removing `pagination.total` from list responses |
| Narrowing an accepted value range | Changing max `limit` from 100 to 50 |
| Changing an HTTP method | `GET /vault/apy` → `POST /vault/apy` |
| Changing an HTTP status code to a semantically different class | `200` → `202 Accepted` for vault deposits |
| Adding a required request field | Making `walletAddress` mandatory on an endpoint where it was optional |
| Changing authentication requirements | Adding auth to a previously open endpoint |
| Changing error response shape in a way that breaks existing parsers | Renaming `error` → `errorCode` in the error body |

---

## 8. Non-breaking changes (safe to ship without a new version)

The following changes may be made to `v1` without bumping to `v2`:

| Category | Examples |
|----------|---------|
| Adding a new optional request field | New optional `assetFilter` query param |
| Adding a new response field | Adding `sharePrice` to vault summary |
| Adding a new endpoint | New `GET /api/v1/vault/strategy` endpoint |
| Relaxing an accepted value range | Raising max `limit` from 100 to 200 |
| Adding a new HTTP status code for a new error condition | Adding `451` for geofenced users on a new endpoint |
| Adding new optional response headers | New `X-RateLimit-Policy` header |
| Correcting documentation | Fixing a typo or misleading example |
| Performance improvements with identical input/output contracts | Query optimization, caching |
| Adding enum values that clients are expected to pass through or ignore | New `type` value in transaction list |

When in doubt, assume a change is breaking and version it.

---

## 9. Client migration guide

### 9.1 Detecting an active deprecation

Check every response for the `Deprecation` header:

```ts
const response = await fetch('https://api.yieldvault.io/api/v1/vault/summary');

if (response.headers.get('Deprecation')) {
  const sunsetDate = response.headers.get('Sunset');
  console.warn(
    `[YieldVault] Deprecated endpoint called. Sunset: ${sunsetDate ?? 'TBD'}. ` +
    `See Link header for the replacement.`
  );
}
```

Log the `Sunset` date in your monitoring dashboard and create a migration task before
that date.

### 9.2 Updating from an unversioned to a versioned base URL

Replace any unversioned base URLs in your HTTP client configuration:

| Before | After |
|--------|-------|
| `https://api.yieldvault.io/auth/login` | `https://api.yieldvault.io/api/v1/auth/login` |
| `https://api.yieldvault.io/api/vault/summary` | `https://api.yieldvault.io/api/v1/vault/summary` |
| `https://api.yieldvault.io/transactions` | `https://api.yieldvault.io/api/v1/transactions` |

If you use a centralized HTTP client or base URL constant, update it once:

```ts
// Before
const BASE = 'https://api.yieldvault.io';

// After
const BASE = 'https://api.yieldvault.io/api/v1';
```

### 9.3 Migrating to a new major version (v1 → v2)

When a new major version is released:

1. **Read the changelog** — the `v2` entry under `## [x.y.z]` in `CHANGELOG.md`
   will list every breaking change and the replacement path for each removed endpoint.
2. **Run both versions in parallel** — during the overlap window you can test your
   client against `v2` while continuing to serve users on `v1`.
3. **Update your base URL** — swap `v1` for `v2` in your HTTP client configuration.
4. **Handle new required fields** — any new required request fields are listed in
   the changelog. Validate your request payloads against the `v2` schema before
   switching.
5. **Drop `v1` after migration** — once you verify `v2` is working in production,
   remove any `v1` fallback paths from your client to avoid accidentally hitting
   deprecated behavior.

### 9.4 Handling `410 Gone`

After a sunset date, deprecated endpoints return `410 Gone`. Ensure your HTTP
client does not silently retry `410` responses:

```ts
if (response.status === 410) {
  const body = await response.json();
  throw new Error(
    `[YieldVault] Endpoint has been retired. ` +
    `Migrate to: ${body.migrateToPath}. Message: ${body.message}`
  );
}
```

### 9.5 Staying informed

- **Watch** the [GitHub repository](https://github.com/Junirezz/YieldVault-RWA)
  for release announcements.
- **Subscribe** to the `#api-updates` channel if your organization has access.
- **Register an API key** so your contact email receives sunset notices
  (see `POST /admin/api-keys/register` in the API documentation).

---

## 10. Version lifecycle stages

Each API version moves through the following stages:

```
Development → Active → Deprecated → Sunset → Retired
```

| Stage | Description | Response headers |
|-------|-------------|-----------------|
| **Development** | Pre-release; available on staging only. Not suitable for production. | `X-API-Version: vN-dev` |
| **Active** | Current production version. All new features land here. | `X-API-Version: vN` |
| **Deprecated** | Successor version exists. Sunset date announced. Existing integrations continue to work. | `Deprecation`, `Sunset`, `Link` added |
| **Sunset** | Past sunset date. Endpoint returns `410 Gone` with migration path. | `410 Gone` body with `migrateToPath` |
| **Retired** | Route removed. Unknown path returns `404 Not Found`. | Standard `404` |

### Version overlap guarantee

When a new major version (`v2`) becomes **Active**, the previous version (`v1`)
will remain **Active** for at least **12 months** before transitioning to
**Deprecated**. This gives all integrators a full year to migrate.

The overlap timeline:

```
v1 Active ──────────────────────────────────┐
                                             ├─ v1 Deprecated (min. 6 months) ─┐
v2 Active ───────────────────────────────────────────────────────────────────────┤
                                                                                 └─ v1 Sunset
```

---

## 11. FAQ

**Q: Can I pin to a specific minor version (e.g., `/api/v1.2`)?**

No. Minor versions are not surfaced in the URL. Within `v1`, all non-breaking
additions are deployed continuously. If a specific response shape is critical to
your integration, validate defensively (check field presence before reading) rather
than relying on a frozen snapshot.

---

**Q: Will you ever ship a breaking change inside `v1`?**

Only for active security vulnerabilities where the risk of keeping the behavior
outweighs the migration cost. In that case, a 7-day emergency notice will be issued
(see [§ 4.1](#41-deprecation-windows-by-change-type)). All other breaking changes go
into a new major version.

---

**Q: How do I know which version an error came from?**

Check `X-API-Version` on the response. It is present on all `4xx` and `5xx`
responses as well as `2xx`.

---

**Q: I'm seeing `Deprecation: true` but no `Sunset` header. When will it be removed?**

A sunset date has not yet been confirmed. The `Deprecation: true` header is an
early signal that the path is in the queue for retirement. A `Sunset` date will be
announced at least 90 days before removal. Migrate at your earliest opportunity.

---

**Q: What if I call an already-sunsetted endpoint?**

You will receive a `410 Gone` response with a `migrateToPath` field pointing to
the canonical replacement. The `410` response is served for 30 days after the
official sunset date, after which the route is removed and returns `404 Not Found`.

---

**Q: Are webhook event schemas versioned separately?**

Webhook payload schemas follow the same versioning rules as REST responses. The
`api_version` field in every webhook event body indicates which schema version
generated the payload. See [WEBHOOK_INTEGRATION.md](../WEBHOOK_INTEGRATION.md)
for webhook-specific migration guidance.

---

**Q: Are Soroban contract interfaces covered by this policy?**

No. The Soroban contract interface is governed separately — on-chain contracts are
immutable once deployed, so upgrades require a new contract deployment and a
protocol-level migration. See
[docs/runbooks/CONTRACT_UPGRADE_PLAYBOOK.md](../runbooks/CONTRACT_UPGRADE_PLAYBOOK.md)
for the contract upgrade process.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-27 | Initial versioning and deprecation policy for Issue #610 |
