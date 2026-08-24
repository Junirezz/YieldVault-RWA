# Operational Safety Events (Issue #971)

## Overview

Operational safety events provide comprehensive observability and auditability for all pause and resume transitions. These events enable monitoring systems, auditors, and governance participants to track all state changes with actor, reason, and timestamp metadata.

## Event Types

### `vault_pause` Event

Emitted when the vault transitions from active to paused state.

**Topics (indexed fields)**:
- `vault_pause` (event signature)

**Data (non-indexed fields)**:
- `actor`: Address that initiated the pause (typically admin)
- `reason_code`: Enumerated pause reason (see table below)
- `timestamp`: Ledger timestamp when pause was enacted

**Reason Codes**:
| Code | Reason | Description |
|------|--------|-------------|
| 0 | None | No specific reason (not typically used) |
| 1 | SecurityIncident | Security vulnerability or attack detected |
| 2 | OracleFailure | Price feed or oracle validation failed |
| 3 | LiquidityCrisis | Insufficient liquidity for withdrawals |
| 4 | Governance | DAO governance decision |
| 5 | Maintenance | Scheduled maintenance or upgrades |
| 6 | Other | Miscellaneous reason |

### `vault_unpause` Event

Emitted when the vault transitions from paused to active state.

**Topics (indexed fields)**:
- `vault_unpause` (event signature)

**Data (non-indexed fields)**:
- `actor`: Address that initiated the unpause (typically admin)
- `timestamp`: Ledger timestamp when resume was enacted

### `pause_fail` Event

Emitted when a pause/unpause transition is attempted but fails.

**Topics (indexed fields)**:
- `pause_fail` (event signature)

**Data (non-indexed fields)**:
- `actor`: Address that attempted the transition
- `reason`: Error message or code explaining failure
- `current_state`: Boolean indicating if vault was already in target state
- `timestamp`: Ledger timestamp of the failed attempt

## Usage Patterns

### Monitoring and Alerting

Listen for `vault_pause` events to detect operational status changes:

```javascript
// Pseudocode: web3.js listener
vault.on('vault_pause', (actor, reason_code, timestamp) => {
  console.log(`⚠️  Vault paused by ${actor} at ${timestamp}`);
  console.log(`Reason: ${reasonCodeToString(reason_code)}`);
  
  // Trigger monitoring alerts
  if (reason_code === 1) { // SecurityIncident
    triggerSeverityAlert('critical');
  }
});
```

### Audit Trail

Events provide a complete audit trail of operational decisions:

1. **Query all pause events**: `eth_getLogs` with topic filter
2. **Extract metadata**: Actor, reason, precise timestamp
3. **Correlate with governance**: Match against proposal execution events
4. **Verify consistency**: Ensure pause/unpause pairs are balanced

### User Communication

Display pause reason to users:

```javascript
const reason = {
  1: 'Security incident detected',
  2: 'Oracle failure',
  3: 'Liquidity crisis',
  4: 'Governance decision',
  5: 'Scheduled maintenance',
  6: 'Other operational reason'
}[reasonCode];

showUserNotification(`Vault paused: ${reason}`);
```

## Safety Guarantees

1. **Completeness**: Every pause/unpause transition emits an event
2. **Atomicity**: Pause state change and event emission are atomic
3. **Ordering**: Events are emitted in the exact order they occur
4. **Persistence**: Events are persisted on-chain and queryable
5. **Immutability**: Event logs cannot be modified after emission

## Integration Points

### Backend Services

Monitor events to:
- Update service availability status
- Scale down user-facing APIs when paused
- Notify staking reward systems
- Trigger compliance reporting

### Frontend Applications

Display pause information via:
- Global notification banner
- Status page indicator
- Disable interaction buttons
- Queue withdrawal transactions

### Governance Systems

Correlate pause events with:
- DAO proposals (who authorized the pause)
- Timelock execution logs
- Multi-signer approval records
- Risk assessment decisions

## Testing

### Unit Tests

```rust
#[test]
fn test_pause_emits_event_with_full_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let vault = setup_vault(&env);
    
    env.ledger().set_timestamp(1000);
    vault.pause(&PauseReason::Maintenance);
    
    // Event emitted with actor, reason, timestamp
    assert!(vault.is_paused());
    assert_eq!(vault.pause_reason(), Some(PauseReason::Maintenance));
}
```

### Integration Tests

Verify event ordering across sequences:
- Multiple pause/unpause cycles
- Concurrent pause attempts
- Pause during strategy operations
- Unpause validation and consistency

See `tests/operational_safety_tests.rs` for comprehensive test suite.

## Error Handling

If a pause or unpause transition fails:

1. **No state change occurs**: Vault remains in current state
2. **`pause_fail` event emitted**: With reason for failure
3. **Error returned to caller**: Full error details provided
4. **No side effects**: No vault state is modified

## Future Enhancements

1. **Pause reason details**: Support structured reason data (e.g., which oracle failed)
2. **Pause duration**: Include estimated duration for maintenance pauses
3. **Pause depth tracking**: Handle nested pauses (emergency pause → security pause)
4. **Event retention**: Automatic archival of old events to external storage
