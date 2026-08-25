# Service Dependency Matrix Reference

Quick reference for understanding service dependencies, startup order, and health checks.

## Service Startup Dependency Graph

```
LEVEL 0 (No Dependencies - Start First)
├── PostgreSQL
└── Redis

LEVEL 1 (Depends on Level 0)
└── Backend API (depends on PostgreSQL, Redis)

LEVEL 2 (Depends on Level 1)
├── Frontend (depends on Backend API)
└── Smart Contracts (independent - Rust/Cargo)

LEVEL 3 (Depends on Level 2)
└── Full system integration testing
```

## Detailed Service Specifications

### PostgreSQL

| Aspect                | Details                                                        |
| --------------------- | -------------------------------------------------------------- |
| **Port**              | 5432                                                           |
| **Container Name**    | `postgres`                                                     |
| **Environment**       | `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`         |
| **Volume**            | `/var/lib/postgresql/data`                                     |
| **Startup Check**     | `psql -U postgres -c "SELECT 1;"`                              |
| **Connection String** | `postgresql://postgres:postgres@localhost:5432/yieldvault_dev` |
| **Health Endpoint**   | N/A (native service)                                           |
| **Dependencies**      | None                                                           |
| **Depended On By**    | Backend API                                                    |

**Docker Start:**

```bash
docker-compose up -d postgres
docker logs -f postgres
```

### Redis

| Aspect                | Details                              |
| --------------------- | ------------------------------------ |
| **Port**              | 6379                                 |
| **Container Name**    | `redis`                              |
| **Configuration**     | Default Redis config                 |
| **Startup Check**     | `redis-cli ping` → `PONG`            |
| **Connection String** | `redis://localhost:6379`             |
| **Health Endpoint**   | `redis-cli` commands                 |
| **Dependencies**      | None                                 |
| **Depended On By**    | Backend API (rate limiting, caching) |

**Docker Start:**

```bash
docker-compose up -d redis
docker logs -f redis
```

### Backend API

| Aspect                 | Details                             |
| ---------------------- | ----------------------------------- |
| **Port**               | 3000                                |
| **Technology**         | Node.js + Express.js + TypeScript   |
| **Health Endpoint**    | `GET /health`                       |
| **Readiness Endpoint** | `GET /ready`                        |
| **Startup Check**      | `curl http://localhost:3000/health` |
| **Startup Time**       | 2-5 seconds                         |
| **Dependencies**       | PostgreSQL, Redis, Stellar RPC      |
| **Depended On By**     | Frontend, Smart Contracts (via RPC) |

The `/health` response reports database, Redis/cache, Stellar RPC, Prisma,
queue, and event indexer states. `/ready` returns `503` while any required
dependency, including the indexer, is unavailable. A `degraded` indexer state
means polling has become stale or has recent failures; inspect
`lastErrorAt`/`lastSuccessfulPollAt`, then restore Stellar RPC and Redis before
restarting the backend. The indexer catches up from the persisted event cursor
after recovery.

**Environment Variables:**

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/yieldvault_dev
REDIS_URL=redis://localhost:6379
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VAULT_CONTRACT_ID=<your_contract_id>
```

**Startup:**

```bash
cd backend
npm install
npx prisma migrate dev
npm run dev
```

**Health Check Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-05-29T10:30:00.000Z",
  "uptime": 3600.5,
  "environment": "development",
  "checks": {
    "api": "up",
    "cache": "up",
    "stellarRpc": "up"
  }
}
```

### Frontend

| Aspect                | Details                                  |
| --------------------- | ---------------------------------------- |
| **Port**              | 5173                                     |
| **Technology**        | React + Vite + TypeScript                |
| **Development Check** | `http://localhost:5173` (should show UI) |
| **Build Command**     | `npm run build`                          |
| **Startup Time**      | 3-8 seconds                              |
| **Dependencies**      | Backend API, Stellar Testnet RPC         |
| **Depended On By**    | End users                                |

**Environment Variables:**

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=<your_contract_id>
```

**Startup:**

```bash
cd frontend
npm install
npm run dev
```

### Smart Contracts

| Aspect             | Details                                                 |
| ------------------ | ------------------------------------------------------- |
| **Port**           | N/A (compiled to WebAssembly)                           |
| **Technology**     | Rust + Soroban                                          |
| **Build Command**  | `cargo build --target wasm32-unknown-unknown --release` |
| **Test Command**   | `cargo test`                                            |
| **Build Time**     | 30-60 seconds (first build longer)                      |
| **Output**         | `.wasm` files in `target/`                              |
| **Dependencies**   | Rust 1.74+, wasm32 target                               |
| **Depended On By** | Deployed to Stellar network                             |

**Setup:**

```bash
cd contracts/vault
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

### Stellar Testnet RPC

| Aspect             | Details                                           |
| ------------------ | ------------------------------------------------- |
| **Endpoint**       | https://soroban-testnet.stellar.org               |
| **Port**           | 443 (HTTPS)                                       |
| **Health Check**   | `curl https://soroban-testnet.stellar.org/health` |
| **Location**       | External service (not local)                      |
| **Dependencies**   | Internet connection                               |
| **Depended On By** | Backend, Frontend, Smart Contracts                |

**Note:** This is an external service. No local startup needed.

## Startup Order Checklist

Follow this checklist to start your local development environment:

```
Priority 1 (Infrastructure - No dependencies)
- [ ] Start PostgreSQL: docker-compose up -d postgres
- [ ] Verify: psql -U postgres -c "SELECT 1;"
- [ ] Start Redis: docker-compose up -d redis
- [ ] Verify: redis-cli ping

Priority 2 (Backend - Depends on Priority 1)
- [ ] cd backend
- [ ] npm install
- [ ] npx prisma migrate dev
- [ ] npm run dev
- [ ] Verify: curl http://localhost:3000/health

Priority 3 (Frontend - Depends on Priority 2)
- [ ] cd ../frontend
- [ ] npm install
- [ ] npm run dev
- [ ] Verify: http://localhost:5173 loads in browser

Priority 4 (Contracts - Optional, Independent)
- [ ] cd ../contracts/vault
- [ ] cargo build --target wasm32-unknown-unknown --release
- [ ] cargo test
```

## Dependency Relationships

### Critical Path for Frontend to Work

```
PostgreSQL → Backend API → Frontend (in browser)
     ↑           ↓             ↓
   Redis    Stellar RPC   Stellar RPC
```

**All of these must be available:**

1. PostgreSQL running
2. Redis running
3. Backend API running and healthy
4. Internet connection to Stellar RPC
5. Frontend development server running

### Critical Path for Smart Contracts

```
Rust 1.74+ → Cargo Build → Contract Tests → Deployment to Stellar
```

## Health Check Commands

Run these to verify each service is operational:

```bash
# PostgreSQL
psql -U postgres -d postgres -c "SELECT version();"

# Redis
redis-cli ping
# Expected: PONG

# Backend API
curl http://localhost:3000/health
# Expected: JSON with "status": "healthy"

# Backend Readiness
curl http://localhost:3000/ready
# Expected: JSON with dependency status

# Frontend (in browser)
open http://localhost:5173
# Expected: See YieldVault UI

# Smart Contracts
cd contracts/vault && cargo test
# Expected: All tests pass

# Stellar RPC
curl https://soroban-testnet.stellar.org/health
# Expected: JSON with service status
```

## Port Allocation

| Service       | Port | Protocol | Access                               |
| ------------- | ---- | -------- | ------------------------------------ |
| PostgreSQL    | 5432 | TCP      | localhost (internal)                 |
| Redis         | 6379 | TCP      | localhost (internal)                 |
| Backend API   | 3000 | HTTP     | http://localhost:3000                |
| Frontend      | 5173 | HTTP     | http://localhost:5173                |
| Stellar RPC   | 443  | HTTPS    | https://soroban-testnet.stellar.org  |
| Prisma Studio | 5555 | HTTP     | http://localhost:5555 (when running) |

**Port Conflict Resolution:**
If a port is already in use:

```bash
# Check what's using the port
netstat -ano | findstr :3000  # Windows
lsof -i :3000                  # macOS/Linux

# Use different port
PORT=3001 npm run dev  # Backend
VITE_DEV_SERVER_PORT=5174 npm run dev  # Frontend
```

## Environment-Specific Configurations

### Local Development

```
Database: PostgreSQL (local Docker)
Cache: Redis (local Docker)
RPC: Soroban Testnet (external)
Contracts: Deployed to Testnet
Network Passphrase: Test SDF Network ; September 2015
```

### Staging/Production

```
Database: PostgreSQL (managed service)
Cache: Redis (managed service)
RPC: Soroban Mainnet (external)
Contracts: Deployed to Mainnet
Network Passphrase: Public Global Stellar Network ; September 2015
```

## Troubleshooting Decision Tree

```
Is the Frontend not loading?
├─ YES → Check port 5173 in browser
│  ├─ Shows blank page → Check backend connection
│  ├─ Shows error → Check browser console
│  └─ Won't connect → Verify Backend is running
└─ NO → Check network request

Is the Backend API not responding?
├─ YES → curl http://localhost:3000/health
│  ├─ No response → Check port 3000
│  ├─ Error 500 → Check Backend logs
│  └─ Error 502 → Check Database
└─ NO → Continue

Is Database connection failing?
├─ YES → docker ps | grep postgres
│  ├─ Not running → docker-compose up -d postgres
│  ├─ Running → psql -U postgres -c "SELECT 1;"
│  └─ psql fails → Check Docker logs
└─ NO → Continue

Is Cache connection failing?
├─ YES → redis-cli ping
│  ├─ No response → docker-compose up -d redis
│  ├─ Running → Check Redis config
│  └─ Error → Check Docker logs
└─ NO → System should be working
```

## Performance Considerations

### Recommended Hardware

For comfortable local development:

- **CPU:** 4+ cores
- **RAM:** 8GB minimum, 16GB recommended
- **Disk:** 5GB free space (for Docker images and node_modules)
- **Network:** Stable internet connection (for Stellar RPC)

### Resource Usage

| Service     | CPU        | RAM        | Disk   |
| ----------- | ---------- | ---------- | ------ |
| PostgreSQL  | Low (idle) | 100-200 MB | 1GB    |
| Redis       | Very Low   | 50-100 MB  | 100 MB |
| Backend API | Low-Medium | 300-500 MB | 500 MB |
| Frontend    | Medium     | 200-400 MB | 2GB    |
| Total       | Moderate   | 1-2 GB     | 4GB    |

### Optimization Tips

1. **Keep containers running** – Reduce startup time
2. **Use `npm ci`** – Faster than `npm install`
3. **Enable Docker caching** – Set up buildkit
4. **Monitor memory** – Use `docker stats`
5. **Use lighter editors** – VS Code preferred over heavy IDEs

---

**Version:** 1.0.0  
**Last Updated:** May 2026
