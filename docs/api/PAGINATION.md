# API Pagination Conventions

This document describes the standardized pagination conventions used across all list endpoints in the YieldVault API.

## Overview

All list endpoints follow consistent pagination patterns to make API consumption predictable and easy to use.

## Query Parameters

### Standard Pagination Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Maximum number of items to return (1-100) |
| `cursor` | string | - | Cursor for cursor-based pagination (opaque string) |
| `page` | number | - | Page number for offset-based pagination (1-based) |
| `sortBy` | string | varies | Field to sort by |
| `sortOrder` | string | 'desc' | Sort direction: 'asc' or 'desc' |

### Endpoint-Specific Parameters

#### Transactions (`GET /api/transactions`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | 'all' | Filter by transaction type: 'deposit', 'withdrawal', or 'all' |
| `walletAddress` | string | - | Filter by wallet address |

#### Portfolio Holdings (`GET /api/portfolio/holdings`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | 'all' | Filter by status: 'active', 'pending', or 'all' |
| `walletAddress` | string | - | Filter by wallet address |

#### Vault History (`GET /api/vault/history`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | string | - | Start date (YYYY-MM-DD format) |
| `to` | string | - | End date (YYYY-MM-DD format) |

## Response Format

All list endpoints return a standardized response structure:

```json
{
  "data": [...],
  "pagination": {
    "count": 20,
    "total": 100,
    "nextCursor": "base64encodedcursor",
    "prevCursor": "base64encodedcursor",
    "currentPage": 1,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "timestamp": "2026-03-28T18:00:00.000Z"
}
```

### Pagination Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Number of items returned in this response |
| `total` | number | Total number of items available (if known) |
| `nextCursor` | string | Cursor for the next page (if more items exist) |
| `prevCursor` | string | Cursor for the previous page (if applicable) |
| `currentPage` | number | Current page number (for offset-based pagination) |
| `totalPages` | number | Total number of pages (if total is known) |
| `hasNextPage` | boolean | Whether there are more items after this page |
| `hasPrevPage` | boolean | Whether there are items before this page |

## Pagination Strategies

### Cursor-Based Pagination (Recommended)

Cursor-based pagination is recommended for most use cases as it provides stable ordering even when data changes between requests.

**How it works:**
1. Make initial request without `cursor` parameter
2. Use `nextCursor` from response for subsequent requests
3. Continue until `hasNextPage` is `false`

**Example:**
```bash
# First page
GET /api/transactions?limit=20

# Next page (using cursor from previous response)
GET /api/transactions?limit=20&cursor=base64encodedcursor
```

**Advantages:**
- Stable ordering even when new items are added
- No duplicate or missing items when paginating
- Efficient for large datasets

### Offset-Based Pagination

Offset-based pagination is simpler but may have issues with changing data.

**How it works:**
1. Use `page` parameter to specify page number (1-based)
2. Use `limit` to specify items per page
3. Calculate total pages from `total` and `limit`

**Example:**
```bash
# First page
GET /api/transactions?limit=20&page=1

# Second page
GET /api/transactions?limit=20&page=2
```

**Advantages:**
- Simple to understand and implement
- Easy to jump to specific pages

**Disadvantages:**
- May show duplicate or missing items if data changes between requests
- Less efficient for large datasets

## Sorting

All list endpoints support sorting by multiple fields.

**Example:**
```bash
# Sort by timestamp descending (newest first)
GET /api/transactions?sortBy=timestamp&sortOrder=desc

# Sort by amount ascending (smallest first)
GET /api/transactions?sortBy=amount&sortOrder=asc
```

## Filtering

Filtering is applied before pagination and sorting.

**Example:**
```bash
# Get only deposits
GET /api/transactions?type=deposit

# Get active holdings for a specific wallet
GET /api/portfolio/holdings?status=active&walletAddress=GABC...
```

## Error Handling

Invalid pagination parameters are handled gracefully:

- Invalid `limit` values are clamped to valid range (1-100)
- Invalid `page` values default to page 1
- Invalid `sortOrder` values default to 'desc'
- Invalid `cursor` values return empty results

## Best Practices

1. **Use cursor-based pagination** for real-time data that may change frequently
2. **Use offset-based pagination** for static or slowly-changing data
3. **Always check `hasNextPage`** before requesting the next page
4. **Use reasonable `limit` values** (20-50 is usually optimal)
5. **Cache responses** when appropriate to reduce API calls
6. **Handle empty results** gracefully (check `count` and `data.length`)

## Examples

### Get first 20 transactions
```bash
curl "http://localhost:3000/api/transactions?limit=20"
```

### Get next page using cursor
```bash
curl "http://localhost:3000/api/transactions?limit=20&cursor=base64encodedcursor"
```

### Get deposits only, sorted by amount
```bash
curl "http://localhost:3000/api/transactions?type=deposit&sortBy=amount&sortOrder=desc"
```

### Get active portfolio holdings for a wallet
```bash
curl "http://localhost:3000/api/portfolio/holdings?status=active&walletAddress=GABC..."
```

### Get vault history for a date range
```bash
curl "http://localhost:3000/api/vault/history?from=2026-01-01&to=2026-03-31&limit=100"
```

## Rate Limiting

All list endpoints are subject to API rate limiting. See [RATE_LIMITING.md](./RATE_LIMITING.md) for details.

## Changelog

### Version 1.0.0 (2026-03-28)
- Initial pagination conventions
- Cursor-based and offset-based pagination support
- Standardized response metadata
- Consistent query parameter naming
