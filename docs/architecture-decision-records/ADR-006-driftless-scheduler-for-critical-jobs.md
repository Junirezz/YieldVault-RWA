# ADR-006: Driftless Scheduler for Critical Hourly Jobs Using setTimeout with Recalculation

**Date:** 2026-09-29  
**Status:** Accepted  
**Author:** YieldVault Engineering  
**Reviewers:** Backend Team, Operations  

---

## Context

The yield accrual job must run at the start of every hour (midnight UTC, 1 AM UTC, etc.) to:
- Accrue yield within a specific time window (5-minute window after hour boundary)
- Avoid duplicate accruals if the job runs twice in one hour
- Meet regulatory audit requirements for consistent, on-time accrual

The original implementation used:
```typescript
setInterval(runYieldAccrual, 60 * 60 * 1000); // 1 hour
```

**Problem:** Event loop lag causes drift accumulation:
- Each iteration adds ~50–100ms of delay (event loop processing, GC, etc.)
- After 1 hour: +50–100ms drift
- After 24 hours: +48 seconds drift (misses the 5-minute accrual window)
- After 72 hours: ~2.4 minutes drift (completely outside accrual window)

Result: **Yield accrual is skipped, causing vaults to miss daily yield for all affected users.**

## Decision

Replace `setInterval` with `setTimeout` that recalculates the next hour boundary at each cycle.

### Algorithm: `msUntilNextHour(now: number): number`

```typescript
export function msUntilNextHour(now: number = Date.now()): number {
  const nextHourMs = Math.ceil(now / 3_600_000) * 3_600_000;
  return Math.max(0, nextHourMs - now);
}
```

**Logic:**
- Divide current time by 3,600,000ms (1 hour)
- `ceil()` rounds up to next hour boundary
- Multiply by 3,600,000 to get the ms timestamp of that boundary
- Return difference

**Examples:**
- At 12:00:30 UTC (43,230,000 ms) → next hour = 13:00:00 (46,800,000 ms) → delay = 3,570,000 ms (59m 30s)
- At 12:59:00 UTC (46,740,000 ms) → next hour = 13:00:00 (46,800,000 ms) → delay = 60,000 ms (1m)
- At 13:00:00 UTC (46,800,000 ms) → next hour = 14:00:00 (50,400,000 ms) → delay = 3,600,000 ms (1h)

### Scheduling: Recursive setTimeout

```typescript
function scheduleNextRun(): void {
  const msUntilNextHourRun = msUntilNextHour(Date.now());
  yieldAccrualTimer = setTimeout(async () => {
    await runYieldAccrualJob();
    scheduleNextRun(); // Recursively schedule next run
  }, msUntilNextHourRun);
}
```

**Why this works:**
1. **No drift:** Each cycle recalculates from actual current time, not a fixed interval
2. **Self-correcting:** If job takes 500ms, next run still happens at hour boundary
3. **Resilient:** Even with event loop delays, subsequent runs realign to hour boundaries

## Rationale

- **Correctness:** Jobs run at exact hour boundaries, not progressively later.
- **Resilience:** Self-corrects from event loop delays; no accumulating error.
- **Simplicity:** Uses only Node.js built-in `setTimeout`; no external dependencies.
- **Testability:** Millisecond-precise scheduling allows deterministic testing with mocked `Date.now()`.
- **Debuggability:** Explicit algorithm visible in code; easier to reason about than magic intervals.

## Alternatives Considered

### Alternative 1: Use `node-cron` or similar library
- **Pros:** Battle-tested; supports complex cron expressions; handles daylight saving time.
- **Cons:** External dependency; added abstraction hides the scheduling algorithm; heavier than needed for simple hourly jobs.
- **Decision:** Rejected; built-in `setTimeout` is sufficient and more transparent.

### Alternative 2: Continue with `setInterval` but compensate for drift
- **Pros:** Minimal code changes.
- **Cons:** Compensation logic is brittle; still accumulates error over weeks; doesn't address the root cause.

### Alternative 3: Event-driven accrual (react to blockchain events)
- **Pros:** Accrual happens as soon as time window opens; no scheduled polling.
- **Cons:** Requires Soroban event stream subscription; more complex error handling; no fallback if events are missed.

## Consequences

### Positive
- **Zero drift:** Jobs always run at exact hour boundaries.
- **Low overhead:** Pure JavaScript; no external process or cron daemon required.
- **Debuggable:** Clear algorithmic logic; easy to trace in logs.
- **Testable:** Mock `Date.now()` to test scheduling at any time of day.

### Negative
- **Recursive timers:** Stack can grow with many recursive `scheduleNextRun()` calls (mitigated by long delays between calls).
- **Application-level scheduling:** If process crashes between accruals, jobs are missed (mitigated by startup routine detecting missed accruals).
- **Single-instance assumption:** This pattern works for single instance; multi-instance deployments need coordination (leader election, etc.) to avoid duplicate accruals.

## Implementation Notes

- **Startup behavior:** On startup, compute `msUntilNextHour()` to schedule first run (may be seconds away or up to 1 hour).
- **Graceful shutdown:** Store `yieldAccrualTimer` and call `clearTimeout()` on process termination.
- **Logging:** Log next scheduled run time at startup and after each execution for visibility.
- **Testing:** Use `jest.useFakeTimers()` and `jest.advanceTimersByTime()` to test scheduling without actual delays.

## Related Links

- Issue #1450 — Fix yield accrual scheduler drift
- `backend/src/yieldAccrualJob.ts` — Scheduler implementation
- `backend/src/__tests__/yieldAccrualJob.test.ts` — Test suite with drift verification
- `YIELD_ACCRUAL_SCHEDULER_FIX.md` — Implementation guide
