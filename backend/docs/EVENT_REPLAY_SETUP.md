# Event Replay - Quick Setup Guide

## Prerequisites

- Node.js installed
- Backend dependencies installed (`npm install`)
- Stellar testnet/mainnet RPC access
- Vault contract deployed

## Setup Steps

### 1. Run Database Migration

```bash
cd backend
npx prisma migrate deploy
```

This creates the `EventCursor` and `ProcessedEvent` tables.

### 2. Configure Environment Variables

Edit your `.env` file:

```bash
# Required: Vault contract to monitor
VAULT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Optional: Customize polling behavior
EVENT_POLL_INTERVAL_MS=10000        # Poll every 10 seconds
EVENT_REPLAY_BATCH_SIZE=100         # Process 100 ledgers per batch

# Stellar RPC (defaults to testnet if not set)
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

### 3. Start the Backend

```bash
npm run dev
```

The event polling service will:
1. Start automatically
2. Check for missed events
3. Replay any gaps
4. Begin continuous polling

### 4. Verify Operation

Check the logs for:

```
[info] Starting event polling service
[info] Starting event replay
[info] Replaying missed events { fromLedger: 1000, toLedger: 1050, missedLedgers: 50 }
[info] Event replay completed { processedCount: 12, duplicateCount: 0, durationMs: 2341 }
[info] Event polling service started { pollIntervalMs: 10000 }
```

### 5. Test Replay Functionality

Simulate a service restart:

```bash
# 1. Stop the service (Ctrl+C)
# 2. Wait 30 seconds for events to accumulate
# 3. Restart the service
npm run dev

# 4. Check logs - you should see replay activity
```

## Verification

### Check Cursor Position

```bash
npx prisma studio
# Navigate to EventCursor table
# Verify lastLedgerSeq is advancing
```

### Check Processed Events

```bash
npx prisma studio
# Navigate to ProcessedEvent table
# Verify events are being recorded
```

### Query Database Directly

```bash
# Using SQLite CLI
sqlite3 prisma/dev.db

# Check cursor
SELECT * FROM EventCursor;

# Check recent events
SELECT * FROM ProcessedEvent ORDER BY processedAt DESC LIMIT 10;

# Count events by type
SELECT eventType, COUNT(*) FROM ProcessedEvent GROUP BY eventType;
```

## Monitoring

### Health Check

The event polling service status is included in the health endpoint:

```bash
curl http://localhost:3000/health
```

### Logs

Monitor logs for:
- Event replay metrics
- Processing errors
- Duplicate detection

```bash
# Filter for event-related logs
npm run dev | grep -i "event"
```

## Troubleshooting

### Service Not Starting

**Check**: Is `VAULT_CONTRACT_ID` set?

```bash
echo $VAULT_CONTRACT_ID
```

If empty, the service won't start (by design).

### No Events Being Processed

**Check**: Is the contract emitting events?

```bash
# Query Stellar RPC directly
curl -X POST $STELLAR_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1000,
      "filters": [{
        "type": "contract",
        "contractIds": ["'$VAULT_CONTRACT_ID'"]
      }]
    }
  }'
```

### Replay Taking Too Long

**Solution**: Increase batch size

```bash
export EVENT_REPLAY_BATCH_SIZE=200
npm run dev
```

## Next Steps

- Review [EVENT_REPLAY.md](./EVENT_REPLAY.md) for detailed documentation
- Set up monitoring alerts for replay duration
- Configure backup RPC endpoints for redundancy
- Implement custom event processing logic in `processEvent()`

## Support

For issues or questions:
1. Check logs for error messages
2. Review [EVENT_REPLAY.md](./EVENT_REPLAY.md) troubleshooting section
3. Open a GitHub issue with logs and configuration
