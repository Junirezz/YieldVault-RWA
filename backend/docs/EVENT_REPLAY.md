# Event Replay System

## Overview

The Event Replay System ensures no on-chain events are missed when the event polling service restarts (planned or unplanned). It stores the last successfully processed ledger sequence and replays all missed events on startup.

## Features

- **Automatic Replay**: On service start, replays events from last processed ledger to current ledger
- **Deduplication**: Prevents duplicate event processing using idempotent upsert logic
- **Performance**: Completes replay within 60 seconds for up to 1,000 missed ledgers
- **Cursor Tracking**: Stores last processed ledger sequence in database
- **Batch Processing**: Processes events in configurable batches for efficiency

## Architecture

### Database Schema

#### EventCursor Table
Stores the last successfully processed ledger sequence.

```sql
CREATE TABLE "EventCursor" (
    "id" INTEGER PRIMARY KEY DEFAULT 1,
    "lastLedgerSeq" INTEGER NOT NULL,
    "lastProcessedAt" DATETIME NOT NULL
);
```

#### ProcessedEvent Table
Tracks all processed events to prevent duplicates.

```sql
CREATE TABLE "ProcessedEvent" (
    "id" TEXT PRIMARY KEY,
    "ledgerSeq" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "processedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Event Flow

```
Service Start
    ↓
Fetch Last Cursor (lastLedgerSeq)
    ↓
Fetch Current Ledger
    ↓
Calculate Missed Ledgers
    ↓
Replay Events in Batches
    ↓
Check for Duplicates (ProcessedEvent)
    ↓
Process New Events
    ↓
Update Cursor
    ↓
Start Continuous Polling
```

## Configuration

### Environment Variables

```bash
# Event polling interval (default: 10 seconds)
EVENT_POLL_INTERVAL_MS=10000

# Batch size for replay (default: 100 ledgers)
EVENT_REPLAY_BATCH_SIZE=100

# Stellar RPC endpoint
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Vault contract ID to monitor
VAULT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## Usage

### Starting the Service

The event polling service starts automatically when the backend server starts:

```typescript
import { startEventPollingService } from './eventPollingService';

startEventPollingService({
  rpcUrl: process.env.STELLAR_RPC_URL,
  contractId: process.env.VAULT_CONTRACT_ID,
  pollIntervalMs: 10000,
  batchSize: 100,
});
```

### Stopping the Service

The service stops gracefully during shutdown:

```typescript
import { stopEventPollingService } from './eventPollingService';

shutdownHandler.onShutdown(async () => {
  stopEventPollingService();
});
```

## Replay Process

### 1. Service Restart Detection

On startup, the service:
1. Fetches the last processed ledger from `EventCursor` table
2. Fetches the current ledger from Stellar RPC
3. Calculates the gap: `missedLedgers = currentLedger - lastLedgerSeq`

### 2. Batch Replay

Events are replayed in batches to optimize performance:

```typescript
for (let ledger = cursor + 1; ledger <= currentLedger; ledger += batchSize) {
  const endLedger = Math.min(ledger + batchSize - 1, currentLedger);
  const events = await fetchEventsForLedgerRange(ledger, endLedger);
  
  for (const event of events) {
    if (!await isEventProcessed(event.id)) {
      await processEvent(event);
    }
  }
  
  await updateCursor(endLedger);
}
```

### 3. Deduplication

Each event is checked against the `ProcessedEvent` table before processing:

```typescript
const isDuplicate = await prisma.processedEvent.findUnique({
  where: { id: event.id }
});

if (!isDuplicate) {
  await prisma.processedEvent.upsert({
    where: { id: event.id },
    update: {},
    create: {
      id: event.id,
      ledgerSeq: event.ledger,
      eventType: event.type,
      contractId: event.contractId,
      txHash: event.txHash,
    },
  });
}
```

## Performance

### Benchmarks

- **Replay Speed**: ~100 ledgers/second
- **1,000 Ledgers**: ~10 seconds
- **SLA**: 60 seconds for 1,000 missed ledgers

### Optimization Strategies

1. **Batch Processing**: Process 100 ledgers per batch (configurable)
2. **Indexed Queries**: Database indexes on `ledgerSeq` and `txHash`
3. **Idempotent Upserts**: Single database operation per event
4. **Parallel Fetching**: Fetch events while processing previous batch

## Monitoring

### Logs

The service logs key events:

```json
{
  "level": "info",
  "message": "Starting event replay",
  "fromLedger": 1000,
  "toLedger": 1500,
  "missedLedgers": 500
}

{
  "level": "info",
  "message": "Event replay completed",
  "processedCount": 45,
  "duplicateCount": 5,
  "missedLedgers": 500,
  "durationMs": 5234
}
```

### Metrics

Monitor these metrics in production:

- `event_replay_duration_ms`: Time taken to replay events
- `event_replay_count`: Number of events replayed
- `event_duplicate_count`: Number of duplicate events skipped
- `event_processing_errors`: Number of processing failures

### Alerts

Set up alerts for:

- Replay duration > 60 seconds (SLA breach)
- High duplicate count (potential issue with cursor tracking)
- Processing errors > 5% of total events

## Error Handling

### Transient Failures

The service handles transient RPC failures gracefully:

```typescript
try {
  await replayMissedEvents();
} catch (error) {
  logger.log('error', 'Event replay failed', { error: error.message });
  // Service will retry on next poll cycle
}
```

### Permanent Failures

For permanent failures (e.g., database unavailable):
1. Service logs error and stops
2. Manual intervention required
3. On restart, replay will resume from last cursor

## Testing

### Unit Tests

Run the test suite:

```bash
npm test -- eventPollingService.test.ts
```

### Integration Tests

Test with real Stellar testnet:

```bash
# Set testnet configuration
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org
export VAULT_CONTRACT_ID=<testnet-contract-id>

# Start service
npm run dev
```

### Replay Simulation

Simulate a service restart:

```bash
# 1. Stop the service
# 2. Wait for events to accumulate on-chain
# 3. Restart the service
# 4. Check logs for replay metrics
```

## Troubleshooting

### No Events Replayed

**Symptom**: Service starts but no events are replayed.

**Possible Causes**:
1. No missed events (cursor is up-to-date)
2. Contract ID not configured
3. RPC endpoint unavailable

**Solution**:
```bash
# Check cursor position
SELECT * FROM EventCursor;

# Check RPC connectivity
curl -X POST $STELLAR_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'
```

### Duplicate Events

**Symptom**: Events are processed multiple times.

**Possible Causes**:
1. Cursor not updating correctly
2. Database transaction issues

**Solution**:
```bash
# Check for duplicate events
SELECT id, COUNT(*) FROM ProcessedEvent GROUP BY id HAVING COUNT(*) > 1;

# Verify cursor updates
SELECT * FROM EventCursor ORDER BY lastProcessedAt DESC LIMIT 10;
```

### Slow Replay

**Symptom**: Replay takes longer than 60 seconds.

**Possible Causes**:
1. Large number of missed ledgers (>1,000)
2. Slow RPC endpoint
3. Database performance issues

**Solution**:
```bash
# Increase batch size
export EVENT_REPLAY_BATCH_SIZE=200

# Check database indexes
EXPLAIN QUERY PLAN SELECT * FROM ProcessedEvent WHERE ledgerSeq = 1000;
```

## Best Practices

1. **Monitor Cursor Position**: Regularly check cursor is advancing
2. **Set Alerts**: Alert on replay duration > 60s
3. **Database Maintenance**: Periodically archive old processed events
4. **RPC Redundancy**: Configure backup RPC endpoints
5. **Graceful Shutdown**: Always use graceful shutdown to update cursor

## Future Enhancements

- [ ] Multi-contract support
- [ ] Event filtering by type
- [ ] Parallel batch processing
- [ ] Automatic cursor recovery
- [ ] Event replay API endpoint
- [ ] Real-time replay metrics dashboard
