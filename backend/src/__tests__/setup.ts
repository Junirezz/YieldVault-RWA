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
// Same reasoning extends to every other tier: any integration test file that
// exercises real auth/read/write/summary/deposit routes across several `it`
// blocks can easily exceed the tight production defaults (e.g. auth: 5/min,
// deposits: 10/min) within a single file's run, well before its assertions
// are about rate limiting at all.
//
// rateLimiter.auth_transfer.test.ts intentionally restores the true tight
// DEPOSITS_RATE_LIMIT_MAX default itself (before importing the limiter
// singletons) because it specifically tests deposits/withdrawals throttling
// behavior at that default — everything else is safe to relax globally since
// no other test relies on hitting these defaults via a real, non-harness
// route (rateLimiter.tiers.test.ts's own /auth,/write,/read,/admin routes are
// exempted from config.max entirely in NODE_ENV=test, see
// createInMemoryLimiter's testHarnessDefaults in rateLimiter.ts).
process.env.RATE_LIMIT_ADMIN_MAX = process.env.RATE_LIMIT_ADMIN_MAX || '10000';
process.env.RATE_LIMIT_WRITES_MAX = process.env.RATE_LIMIT_WRITES_MAX || '10000';
process.env.RATE_LIMIT_AUTH_MAX = process.env.RATE_LIMIT_AUTH_MAX || '10000';
process.env.DEPOSITS_RATE_LIMIT_MAX = process.env.DEPOSITS_RATE_LIMIT_MAX || '10000';
process.env.RATE_LIMIT_READS_MAX = process.env.RATE_LIMIT_READS_MAX || '10000';
process.env.SUMMARY_RATE_LIMIT_MAX = process.env.SUMMARY_RATE_LIMIT_MAX || '10000';
process.env.API_RATE_LIMIT_MAX_REQUESTS = process.env.API_RATE_LIMIT_MAX_REQUESTS || '10000';

// Adaptive throttle (src/middleware/adaptiveThrottle.ts) tracks a per-IP
// abuse score across every response in the app (any 4xx adds to it) and,
// once it crosses this threshold, blocks that IP with an escalating delay.
// Integration test files that deliberately exercise several validation-error
// paths (400s, 401s, 403s) accumulate this score exactly like production
// abuse would, then get 429s in later, unrelated test cases in the same
// file. Raise the threshold sky-high so the mechanism stays exercised by its
// own dedicated tests (if any) without tripping incidentally.
process.env.ADAPTIVE_THROTTLE_SCORE_THRESHOLD = process.env.ADAPTIVE_THROTTLE_SCORE_THRESHOLD || '1000000';

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

/**
 * Valid Stellar test wallets — real Ed25519 public keys (correct StrKey
 * checksum), not just regex-shaped strings. Endpoints validated via the
 * character-class-only regex in @yieldvault/api-schemas tolerated the old
 * hand-typed placeholders, but anything validated via the stricter
 * StrKey.isValidEd25519PublicKey check (login, nonce, signed actions —
 * walletAddressSchema in middleware/validate.ts) rejected them outright.
 */
export const VALID_TEST_WALLET =
  'GBF2VOZSQLF2BZRW6NIDETV2L3I6GHXZUEFSIESELEAGATV2FYTOHOHI';

/** Second valid wallet for multi-wallet test scenarios. */
export const SECOND_TEST_WALLET =
  'GAB5ZIMWXPZBBTCYQYICI4LJJW2F5PQ3Z3KJJB3SSY66B45KC2KSLIFD';

/** Third valid wallet for multi-wallet test scenarios. */
export const THIRD_TEST_WALLET =
  'GASEUS2QGJBV5OX2J6AKIORVEA242PQLMRZXCJYN5CZR5G5A65ONOI3N';
