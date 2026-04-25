/**
 * Circuit breaker for Soroban RPC calls.
 *
 * States:
 *   CLOSED   – normal operation, calls pass through
 *   OPEN     – circuit tripped; calls fail fast with 503 + Retry-After
 *   HALF_OPEN – one probe call allowed to test recovery
 *
 * Configuration (env vars):
 *   CIRCUIT_BREAKER_FAILURE_THRESHOLD  – consecutive failures before opening (default: 5)
 *   CIRCUIT_BREAKER_WINDOW_MS          – window to count failures in ms (default: 30000)
 *   CIRCUIT_BREAKER_COOLDOWN_MS        – time before transitioning to half-open (default: 30000)
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Soroban RPC circuit breaker is OPEN');
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

interface CircuitBreakerOptions {
  failureThreshold?: number;
  windowMs?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private windowStart = Date.now();
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold =
      opts.failureThreshold ??
      parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10);
    this.windowMs =
      opts.windowMs ??
      parseInt(process.env.CIRCUIT_BREAKER_WINDOW_MS || '30000', 10);
    this.cooldownMs =
      opts.cooldownMs ??
      parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '30000', 10);
  }

  get currentState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /** Milliseconds until the circuit may attempt recovery (0 if not open). */
  get retryAfterMs(): number {
    if (this.state !== 'OPEN' || this.openedAt === null) return 0;
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.cooldownMs - elapsed);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.retryAfterMs);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.windowStart = Date.now();
    this.state = 'CLOSED';
    this.openedAt = null;
  }

  private onFailure(): void {
    const now = Date.now();

    // Reset window if it has expired
    if (now - this.windowStart > this.windowMs) {
      this.failures = 0;
      this.windowStart = now;
    }

    this.failures += 1;

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = now;
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'OPEN' &&
      this.openedAt !== null &&
      Date.now() - this.openedAt >= this.cooldownMs
    ) {
      this.state = 'HALF_OPEN';
    }
  }

  /** Serialisable snapshot for the /health endpoint. */
  toHealthSnapshot(): { state: CircuitState; failures: number; retryAfterMs: number } {
    return {
      state: this.currentState,
      failures: this.failures,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/** Singleton used by all Soroban RPC call sites. */
export const sorobanCircuitBreaker = new CircuitBreaker();
