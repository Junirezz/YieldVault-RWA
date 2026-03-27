# YieldVault Backend API

Express.js backend server for YieldVault Stellar RWA platform with rate limiting and health monitoring.

## Features

- **Health Check Endpoint** (`/health`) - Real-time service health status
- **Readiness Endpoint** (`/ready`) - Dependency status for deployment orchestration
- **Rate Limiting** - Per-IP and per-API-key rate limiting to prevent abuse
- **Dependency Monitoring** - Checks for cache and Stellar RPC availability
- **Error Handling** - Consistent JSON error responses
- **TypeScript** - Full type safety with TypeScript

## Quick Start

### Setup

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### Development

```bash
# Start development server with auto-reload
npm run dev
```

The server will start on `http://localhost:3000`.

### Production

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## Configuration

Rate limiting and other settings are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Global rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Global requests per window |
| `API_RATE_LIMIT_WINDOW_MS` | 60000 | API rate limit window (1 min) |
| `API_RATE_LIMIT_MAX_REQUESTS` | 30 | API requests per window |
| `STELLAR_RPC_URL` | https://soroban-testnet.stellar.org | Stellar RPC endpoint |

## API Endpoints

### Health Check

```
GET /health
```

Returns service health status with dependency checks.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-03-26T10:30:00.000Z",
  "uptime": 3600.5,
  "environment": "development",
  "checks": {
    "api": "up",
    "cache": "up",
    "stellarRpc": "up"
  }
}
```

### Readiness Check

```
GET /ready
```

Returns service readiness state. Checks all critical dependencies before reporting ready.

**Response (200 OK - Ready):**
```json
{
  "ready": true,
  "timestamp": "2026-03-26T10:30:00.000Z",
  "dependencies": {
    "cache": true,
    "stellarRpc": true
  }
}
```

**Response (503 Unavailable - Not Ready):**
```json
{
  "ready": false,
  "timestamp": "2026-03-26T10:30:00.000Z",
  "dependencies": {
    "cache": false,
    "stellarRpc": false
  }
}
```

### Rate Limit Exceeded

```
Status: 429 Too Many Requests
```

```json
{
  "error": "Too many requests",
  "status": 429,
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 1711432200000
}
```

## Rate Limiting

### Global Rate Limiting

Applied to all requests except `/health` and `/ready`:
- Window: 15 minutes (configurable)
- Max: 100 requests per window (configurable)
- Per: IP address

### API Endpoint Rate Limiting

Stricter limits for API endpoints (e.g., `/api/vault/summary`):
- Window: 1 minute (configurable)
- Max: 30 requests per window (configurable)
- Per: API key (from `x-api-key` header) or IP address

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage
```

## Issues Addressed

### Issue #145: Rate Limiting
- ✅ Global rate limiting per IP
- ✅ Per-user/API-key rate limiting
- ✅ Configurable via environment variables
- ✅ Clear 429 responses with retry information
- ✅ Tests included for rate limiting behavior

### Issue #148: Health & Readiness Endpoints
- ✅ `/health` endpoint for service health
- ✅ `/ready` endpoint for deployment readiness
- ✅ Dependency health checks (cache, RPC)
- ✅ CI smoke test setup via npm scripts
- ✅ Consistent response formats

## CI/CD Integration

### Smoke Test (CI Pipeline)

```bash
# Build and start server
npm run test:smoke

# The server will start in background, ready for health checks
# Call: curl http://localhost:3000/health
# Call: curl http://localhost:3000/ready
```

### Docker Deployment

Example Dockerfile:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"
CMD ["npm", "start"]
```

## Monitoring

Headers returned in responses:

- `RateLimit-Limit` - Request limit
- `RateLimit-Remaining` - Requests remaining
- `RateLimit-Reset` - Reset timestamp

Example:
```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1711432200
```

## License

MIT
