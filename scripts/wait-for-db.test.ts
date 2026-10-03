import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseDatabaseUrl,
  waitForDb,
  type WaitForDbOptions,
} from './wait-for-db';

describe('wait-for-db', () => {
  let logs: string[] = [];
  let errors: string[] = [];

  const mockLogger = {
    log: (msg: string) => {
      logs.push(msg);
    },
    error: (msg: string) => {
      errors.push(msg);
    },
  };

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.clearAllMocks();
  });

  describe('parseDatabaseUrl', () => {
    it('correctly parses standard postgres url', () => {
      const parsed = parseDatabaseUrl('postgres://myuser:mypass@dbhost:5433/mydb');
      expect(parsed).toEqual({
        host: 'dbhost',
        port: 5433,
        user: 'myuser',
        database: 'mydb',
      });
    });

    it('returns empty object on empty or invalid url', () => {
      expect(parseDatabaseUrl(undefined)).toEqual({});
      expect(parseDatabaseUrl('')).toEqual({});
      expect(parseDatabaseUrl('invalid-url')).toEqual({});
    });
  });

  describe('waitForDb logic', () => {
    it('succeeds immediately when database is already ready', async () => {
      let attempts = 0;
      const checker = vi.fn(async () => {
        attempts++;
        return true;
      });

      const res = await waitForDb({
        timeoutSeconds: 5,
        intervalMs: 10,
        checker,
        logger: mockLogger,
      });

      expect(res.success).toBe(true);
      expect(attempts).toBe(1);
      expect(logs).toContainEqual(expect.stringContaining('PostgreSQL is ready'));
      expect(errors.length).toBe(0);
    });

    it('retries and succeeds when database becomes ready after initial failures', async () => {
      let attempts = 0;
      const checker = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          return false;
        }
        return true;
      });

      const res = await waitForDb({
        timeoutSeconds: 5,
        intervalMs: 10,
        checker,
        logger: mockLogger,
      });

      expect(res.success).toBe(true);
      expect(attempts).toBe(3);
      expect(logs).toContainEqual(expect.stringContaining('Waiting for PostgreSQL...'));
      expect(logs).toContainEqual(expect.stringContaining('PostgreSQL is ready'));
      expect(errors.length).toBe(0);
    });

    it('times out and fails when database never becomes ready within timeout', async () => {
      const checker = vi.fn(async () => false);

      const res = await waitForDb({
        timeoutSeconds: 0.05, // 50ms timeout for test speed
        intervalMs: 10,
        checker,
        logger: mockLogger,
      });

      expect(res.success).toBe(false);
      expect(errors).toContainEqual(expect.stringContaining('Error: Timed out waiting'));
    });

    it('handles exceptions thrown by checker gracefully by retrying', async () => {
      let attempts = 0;
      const checker = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ECONNREFUSED');
        }
        return true;
      });

      const res = await waitForDb({
        timeoutSeconds: 5,
        intervalMs: 10,
        checker,
        logger: mockLogger,
      });

      expect(res.success).toBe(true);
      expect(attempts).toBe(2);
      expect(logs).toContainEqual(expect.stringContaining('PostgreSQL is ready'));
    });
  });

  describe('wait-for-db.sh script integrity', () => {
    it('exists and contains pg_isready check and 30s default timeout', () => {
      const scriptPath = path.resolve(__dirname, 'wait-for-db.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);

      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('pg_isready');
      expect(content).toContain('TIMEOUT="${WAIT_FOR_DB_TIMEOUT:-30}"');
      expect(content).toContain('HOST="${POSTGRES_HOST:-localhost}"');
      expect(content).toContain('PORT="${POSTGRES_PORT:-5432}"');
    });
  });
});
