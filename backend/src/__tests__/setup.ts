import dotenv from 'dotenv';

// CRITICAL: Set NODE_ENV first to ensure environment-aware initialization
process.env.NODE_ENV = 'test';

// Load environment variables for tests with override
// This must happen before any modules initialize Prisma or tracing
dotenv.config({
  path: '.env.test',
  override: true,
});

// Explicitly disable tracing for all tests
process.env.OTEL_ENABLED = 'false';

// Suppress OpenTelemetry spam in test output
process.env.OTEL_LOG_LEVEL = 'error';

// Provide healthy defaults expected by API/integration tests.
process.env.STELLAR_RPC_URL = process.env.STELLAR_RPC_URL || 'https://test-rpc.stellar.local';
process.env.ALLOWLIST_ENABLED = process.env.ALLOWLIST_ENABLED || 'false';

// Disable rate limiting for RBAC/security tests by using very high limits.
// The admin limiter defaults to 20 req/min which is too low for comprehensive
// endpoint-level security tests that fire 100+ requests in rapid succession.
process.env.RATE_LIMIT_ADMIN_MAX = process.env.RATE_LIMIT_ADMIN_MAX || '10000';
process.env.RATE_LIMIT_WRITES_MAX = process.env.RATE_LIMIT_WRITES_MAX || '10000';

// CRITICAL: Patch PrismaClient constructor BEFORE any code tries to instantiate it
// This intercepts the instrumentation hooks and prevents the panic
const PrismaClientModule = require('@prisma/client');
const OriginalPrismaClient = PrismaClientModule.PrismaClient;

class PatchedPrismaClient extends OriginalPrismaClient {
  constructor(options?: any) {
    // Remove any corrupted options that the instrumentation added
    const cleanOptions = options || {};
    // Strip out any unrecognized instrumentation-related fields
    if (cleanOptions._lib) {
      delete cleanOptions._lib;
    }
    super(cleanOptions);
  }
}

// Replace the exported PrismaClient
PrismaClientModule.PrismaClient = PatchedPrismaClient;

// Register default admin API keys for integration tests that use test-admin-key.
const { registerApiKey } = require('../middleware/apiKeyAuth') as typeof import('../middleware/apiKeyAuth');
const defaultAdminKey = process.env.ADMIN_API_KEY || 'test-admin-key';
registerApiKey(defaultAdminKey);
registerApiKey('super-admin-test-key', { role: 'super-admin' });

/** Valid 56-character Stellar test wallet (G + 55 base32 chars). */
export const VALID_TEST_WALLET =
  'G234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ';

/** Second valid wallet for multi-wallet test scenarios. */
export const SECOND_TEST_WALLET =
  'G345678ABCDEFGHIJKLMNOPQRSTUVWXYZ345678ABCDEFGHIJKLMNOPQR';

/** Third valid wallet for multi-wallet test scenarios. */
export const THIRD_TEST_WALLET =
  'G456789ABCDEFGHIJKLMNOPQRSTUVWXYZ456789ABCDEFGHIJKLMNOPQR';
