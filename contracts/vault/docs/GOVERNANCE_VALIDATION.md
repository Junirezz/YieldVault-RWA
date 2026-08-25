# Governance Validation (Issue #973)

## Overview

This module ensures that governance operations only execute when all required conditions are satisfied. Policy updates pass through rigorous validation checks including quorum verification, proposal freshness, voting period enforcement, and state machine validation.

## Governance State Machine

All proposals follow a deterministic state machine with valid transitions:

```
    ┌─────────────────────────────────────────────────┐
    │                                                 │
    ▼                                                 │
[None] ──create──> [Active] ──vote──> [Approved] ──execute──> [Executed]
                      │                   │
                      │ too old           │ error
                      ▼                   ▼
                   [Stale]            [Rejected]
                      │                   │
                      └─── Terminal ─────┘
```

### Valid Transitions

| From | To | Condition | Description |
|------|----|-----------| |
| Active | Approved | Quorum met + not stale + minimum voting period elapsed | Proposal ready for execution |
| Active | Stale | Age exceeds max_age_seconds | Proposal expired without quorum |
| Active | Rejected | Cancelled by governance | Proposal explicitly rejected |
| Approved | Executed | All conditions met at execution time | Proposal successfully executed |
| (any terminal) | - | N/A | No transitions from terminal states |

### Invalid Transitions

These transitions are rejected:
- Stale → Approved (expired proposals cannot be rescued)
- Rejected → Executed (rejected proposals cannot execute)
- Executed → * (executed proposals are immutable)
- Approved → Active (cannot revert to voting)

## Validation Checklist

### 1. Quorum Validation

Ensures sufficient votes/approvals have been collected.

**Rule**: `votes_received >= quorum`

**Examples**:

```rust
// Configuration: 2 of 3 signers required
let config = GovernanceConfig {
    quorum: 2,
    total_signers: 3,
    ...
};

// ✓ Valid: quorum met
validate_quorum(2, &config)?;  // Exactly at threshold
validate_quorum(3, &config)?;  // Exceeds threshold

// ✗ Invalid: quorum not met
validate_quorum(1, &config)?;  // Below threshold
validate_quorum(0, &config)?;  // No votes
```

### 2. Proposal Freshness Validation

Ensures proposals haven't aged beyond maximum allowed age.

**Rule**: `current_time - proposal_created_at <= max_age_seconds`

**Parameters**:

| Parameter | Typical Value | Purpose |
|-----------|---------------|---------|
| max_age_seconds | 86400 (1 day) | Prevent indefinitely old proposals |
| created_at | Ledger timestamp | When proposal was created |
| current_time | Ledger timestamp | Current block time |

**Examples**:

```rust
// ✓ Valid: proposal is fresh
validate_proposal_freshness(1000, 2000, 3600)?;  // 1000s old, max 3600s
validate_proposal_freshness(1000, 4599, 3600)?;  // Just within limit

// ✗ Invalid: proposal is stale
validate_proposal_freshness(1000, 4600, 3600)?;  // Exceeds max age
validate_proposal_freshness(1000, 100_000, 3600)?; // Way too old
```

### 3. Minimum Voting Period Validation

Ensures sufficient voting time has elapsed before execution.

**Rule**: `current_time - voting_started_at >= min_voting_period_seconds`

**Purpose**: 
- Allows time for community review
- Prevents flash-loan governance attacks
- Gives users opportunity to exit before controversial changes

**Parameters**:

| Parameter | Typical Value | Purpose |
|-----------|---------------|---------|
| min_voting_period | 3600 (1 hour) | Minimum deliberation time |
| voting_started | Ledger timestamp | When voting commenced |
| current_time | Ledger timestamp | Current block time |

**Examples**:

```rust
// ✓ Valid: voting period has elapsed
validate_minimum_voting_period(1000, 5000, 3600)?;  // 4000s elapsed, need 3600s
validate_minimum_voting_period(1000, 4600, 3600)?;  // Exactly at threshold

// ✗ Invalid: voting period not completed
validate_minimum_voting_period(1000, 2000, 3600)?;  // Only 1000s elapsed
validate_minimum_voting_period(1000, 1000, 3600)?;  // No time has passed
```

### 4. Signer Set Consistency Validation

Ensures the set of authorized signers hasn't changed between proposal creation and execution.

**Rule**: `original_signers == current_signers` (sorted, deduplicated)

**Purpose**: 
- Prevents signers from being added mid-voting
- Ensures votes were collected with known signer set
- Blocks "signer swap" attacks

**Examples**:

```rust
// ✓ Valid: signer set unchanged
let signers1 = [addr1, addr2, addr3];
let signers2 = [addr1, addr2, addr3];
validate_signer_set_unchanged(&signers1, &signers2)?;

// ✗ Invalid: signers changed
let signers1 = [addr1, addr2, addr3];
let signers2 = [addr1, addr2, addr4];  // addr3 replaced with addr4
validate_signer_set_unchanged(&signers1, &signers2)?;

// ✗ Invalid: signers added
let signers1 = [addr1, addr2];
let signers2 = [addr1, addr2, addr3];  // addr3 added
validate_signer_set_unchanged(&signers1, &signers2)?;
```

## Comprehensive Validation

### Policy Update Proposal Validation

The `validate_policy_update_proposal()` function performs all checks in sequence:

```rust
pub fn validate_policy_update_proposal(
    votes_received: u32,
    proposal_created_at: u64,
    current_timestamp: u64,
    config: &GovernanceConfig,
    already_executed: bool,
    original_signers: &Vec<Address>,
    current_signers: &Vec<Address>,
) -> Result<(), VaultError>
```

**Validation Sequence**:

1. **Quorum Check**: Are there enough votes?
   - If fails: `InsufficientGovernanceVotes`

2. **Freshness Check**: Is proposal still within age limit?
   - If fails: `ProposalStale`

3. **Voting Period Check**: Has enough time elapsed?
   - If fails: `ProposalNotReady`

4. **Already Executed Check**: Has this already been executed?
   - If fails: `ProposalAlreadyExecuted`

5. **Signer Consistency Check**: Are signers the same?
   - If fails: `GovernanceSignersChanged`

**Examples**:

```rust
// ✓ Valid: all checks pass
let config = GovernanceConfig {
    quorum: 2,
    total_signers: 3,
    proposal_max_age_seconds: 86400,
    min_voting_period_seconds: 3600,
};

let result = validate_policy_update_proposal(
    votes_received: 2,         // Quorum met
    proposal_created_at: 1000,
    current_timestamp: 5000,   // Voting period elapsed
    config: &config,
    already_executed: false,   // Not executed
    original_signers: &signers,
    current_signers: &signers, // Same signers
)?;  // ✓ All checks pass

// ✗ Invalid: quorum not met
let result = validate_policy_update_proposal(
    votes_received: 1,         // ✗ Below quorum
    ...
)?;  // Err(InsufficientGovernanceVotes)

// ✗ Invalid: proposal too old
let result = validate_policy_update_proposal(
    votes_received: 2,
    proposal_created_at: 1000,
    current_timestamp: 100_000, // ✗ Way too old
    config: &config,
    ...
)?;  // Err(ProposalStale)
```

## Error Codes

| Error | Cause | Action |
|-------|-------|--------|
| `InsufficientGovernanceVotes` | Quorum not met | Collect more votes |
| `ProposalStale` | Too much time passed | Resubmit proposal |
| `ProposalNotReady` | Voting period not elapsed | Wait before execution |
| `ProposalAlreadyExecuted` | Already executed | Check execution record |
| `GovernanceSignersChanged` | Signer set modified | Resubmit with current signers |
| `InvalidProposalTransition` | Invalid state change | Follow state machine |

## Configuration Examples

### Conservative Governance (DAO-like)

```rust
GovernanceConfig {
    quorum: 4,                        // 4 of 7 signers
    total_signers: 7,
    proposal_max_age_seconds: 604_800, // 1 week
    min_voting_period_seconds: 86_400, // 1 day
}
```

### Rapid Governance (Emergency Operations)

```rust
GovernanceConfig {
    quorum: 2,                        // 2 of 3 signers
    total_signers: 3,
    proposal_max_age_seconds: 3600,   // 1 hour
    min_voting_period_seconds: 300,   // 5 minutes
}
```

### Single Admin (During Initialization)

```rust
GovernanceConfig {
    quorum: 1,                        // Admin only
    total_signers: 1,
    proposal_max_age_seconds: 604_800, // Still enforced
    min_voting_period_seconds: 0,     // No voting period
}
```

## Testing

### Unit Tests

```rust
#[test]
fn test_quorum_validation() {
    let config = GovernanceConfig { quorum: 2, ... };
    assert!(validate_quorum(2, &config).is_ok());
    assert!(validate_quorum(1, &config).is_err());
}

#[test]
fn test_proposal_freshness() {
    assert!(validate_proposal_freshness(1000, 2000, 3600).is_ok());
    assert!(validate_proposal_freshness(1000, 100_000, 3600).is_err());
}

#[test]
fn test_voting_period() {
    assert!(validate_minimum_voting_period(1000, 5000, 3600).is_ok());
    assert!(validate_minimum_voting_period(1000, 2000, 3600).is_err());
}

#[test]
fn test_state_transitions() {
    assert!(validate_state_transition(Active, Approved).is_ok());
    assert!(validate_state_transition(Stale, Approved).is_err());
}
```

### Integration Tests

Test full governance workflows:
- Create proposal → collect votes → execute
- Attempt to execute stale proposal (should fail)
- Change signers mid-proposal (should fail execution)
- Execute with minimum quorum (boundary case)

See `tests/operational_safety_tests.rs` for comprehensive test suite.

## Future Enhancements

1. **Tiered Governance**: Different thresholds for different operations
2. **Delegation**: Allow signers to delegate voting power
3. **Veto Power**: Override mechanism for emergency situations
4. **Governance History**: Detailed tracking of all proposals and votes
5. **Ranked Governance**: Support alternative voting mechanisms
