import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker';

const success = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('rpc error'));

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 5000, cooldownMs: 1000 });
  });

  it('starts CLOSED', () => {
    expect(cb.currentState).toBe('CLOSED');
  });

  it('stays CLOSED below threshold', async () => {
    await expect(cb.execute(fail)).rejects.toThrow('rpc error');
    await expect(cb.execute(fail)).rejects.toThrow('rpc error');
    expect(cb.currentState).toBe('CLOSED');
  });

  it('opens after reaching failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    expect(cb.currentState).toBe('OPEN');
  });

  it('throws CircuitOpenError when OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    await expect(cb.execute(success)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after cooldown', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    // Manually backdate openedAt to simulate cooldown elapsed
    (cb as any).openedAt = Date.now() - 2000;
    expect(cb.currentState).toBe('HALF_OPEN');
  });

  it('closes again after a successful probe in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    (cb as any).openedAt = Date.now() - 2000;
    await cb.execute(success);
    expect(cb.currentState).toBe('CLOSED');
  });

  it('exposes health snapshot', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    const snap = cb.toHealthSnapshot();
    expect(snap.state).toBe('OPEN');
    expect(snap.failures).toBe(3);
    expect(snap.retryAfterMs).toBeGreaterThan(0);
  });
});
