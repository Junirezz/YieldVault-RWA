import { logger } from './middleware/structuredLogging';
import { observeExternalDependency } from './metrics';

export interface DependencyProbeState {
  status: 'up' | 'down' | 'degraded';
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
}

export type DependencyName = 'database' | 'cache' | 'stellarRpc' | 'prisma' | 'queue' | 'indexer';

type ProbeFunction = () => Promise<'up' | 'down'>;

interface ProbeRegistration {
  name: DependencyName;
  probe: ProbeFunction;
}

class HealthProbeService {
  private probes = new Map<DependencyName, ProbeRegistration>();
  private states = new Map<DependencyName, DependencyProbeState>();

  register(name: DependencyName, probe: ProbeFunction): void {
    this.probes.set(name, { name, probe });
    if (!this.states.has(name)) {
      this.states.set(name, {
        status: 'up',
        latencyMs: null,
        lastCheckedAt: null,
        lastError: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
      });
    }
  }

  async checkDependency(name: DependencyName): Promise<DependencyProbeState> {
    const registration = this.probes.get(name);
    const state = this.states.get(name) ?? this.createDefaultState();

    if (!registration) {
      state.status = 'down';
      state.lastError = 'Probe not registered';
      state.lastCheckedAt = new Date().toISOString();
      return state;
    }

    const startMs = Date.now();

    try {
      const result = await registration.probe();
      const latencyMs = Date.now() - startMs;
      observeExternalDependency(name, 'health_probe', latencyMs, result === 'up' ? 'success' : 'failure');

      state.status = result;
      state.latencyMs = latencyMs;
      state.lastCheckedAt = new Date().toISOString();

      if (result === 'up') {
        state.consecutiveFailures = 0;
      } else {
        state.consecutiveFailures += 1;
        state.lastError = 'Probe returned down';
        state.lastErrorAt = new Date().toISOString();
      }
    } catch (error) {
      const latencyMs = Date.now() - startMs;
      observeExternalDependency(name, 'health_probe', latencyMs, 'failure');
      state.status = 'down';
      state.latencyMs = latencyMs;
      state.lastCheckedAt = new Date().toISOString();
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastErrorAt = new Date().toISOString();
      state.consecutiveFailures += 1;
    }

    if (state.consecutiveFailures > 0 && state.consecutiveFailures < 3 && state.status !== 'up') {
      state.status = 'degraded';
    }

    this.states.set(name, state);
    return { ...state };
  }

  async checkAll(): Promise<Record<DependencyName, DependencyProbeState>> {
    const names = Array.from(this.probes.keys());
    const results = await Promise.all(names.map((name) => this.checkDependency(name)));

    const record: Partial<Record<DependencyName, DependencyProbeState>> = {};
    for (let i = 0; i < names.length; i++) {
      record[names[i]] = results[i];
    }

    return record as Record<DependencyName, DependencyProbeState>;
  }

  getLastState(name: DependencyName): DependencyProbeState | null {
    return this.states.get(name) ?? null;
  }

  getAllStates(): Record<string, DependencyProbeState> {
    const result: Record<string, DependencyProbeState> = {};
    for (const [name, state] of this.states) {
      result[name] = { ...state };
    }
    return result;
  }

  isHealthy(): boolean {
    for (const state of this.states.values()) {
      if (state.status === 'down') return false;
    }
    return true;
  }

  private createDefaultState(): DependencyProbeState {
    return {
      status: 'up',
      latencyMs: null,
      lastCheckedAt: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
    };
  }

  clear(): void {
    this.probes.clear();
    this.states.clear();
  }
}

export const healthProbeService = new HealthProbeService();
