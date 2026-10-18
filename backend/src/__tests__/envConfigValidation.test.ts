import { parseEnv } from '../config/env';
import { assertAdminReceiptSecretValid } from '../adminReceipt';

describe('Issue #1613 — Env parsing, bounds, and production requirements', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('parses valid numeric env variables and applies defaults', () => {
    const parsed = parseEnv({
      PORT: '8080',
      DRAIN_TIMEOUT_MS: '45000',
      JWT_ACCESS_TTL_SECONDS: '1800',
      JWT_REFRESH_TTL_SECONDS: '86400',
    });

    expect(parsed.PORT).toBe(8080);
    expect(parsed.DRAIN_TIMEOUT_MS).toBe(45000);
    expect(parsed.JWT_ACCESS_TTL_SECONDS).toBe(1800);
    expect(parsed.JWT_REFRESH_TTL_SECONDS).toBe(86400);
    expect(parsed.NODE_ENV).toBe('development');
  });

  it('exits fast in production on invalid values such as JWT_ACCESS_TTL_SECONDS=abc', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
      throw new Error(`process.exit called with ${code}`);
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      parseEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_TTL_SECONDS: 'abc',
        ADMIN_ACTION_RECEIPT_SECRET: 'production-secret-123',
      });
    }).toThrow(/process.exit called with 1/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Environment validation failed'));
  });

  it('requires ADMIN_ACTION_RECEIPT_SECRET in production', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
      throw new Error(`process.exit called with ${code}`);
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      parseEnv({
        NODE_ENV: 'production',
        ADMIN_ACTION_RECEIPT_SECRET: '',
      });
    }).toThrow(/process.exit called with 1/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ADMIN_ACTION_RECEIPT_SECRET is required in production'));
  });

  it('assertAdminReceiptSecretValid enforces receipt secret in production', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
      throw new Error(`process.exit called with ${code}`);
    });

    jest.spyOn(console, 'error').mockImplementation(() => {});

    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_ACTION_RECEIPT_SECRET;

    expect(() => {
      assertAdminReceiptSecretValid();
    }).toThrow(/process.exit called with 1/);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('falls back to info with a warning when LOG_LEVEL is invalid', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const parsed = parseEnv({
      LOG_LEVEL: 'INVALID_VERBOSE_LEVEL',
    });

    expect(parsed.LOG_LEVEL).toBe('info');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid LOG_LEVEL "INVALID_VERBOSE_LEVEL". Falling back to "info".'),
    );
  });
});
