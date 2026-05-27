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

// Ensure health/readiness checks pass in test mode even without external RPC configuration
process.env.STELLAR_RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';

// Set test Soroban configuration (required for submitVaultOperation)
// In tests, these won't actually be used for real transactions
process.env.STELLAR_NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
if (!process.env.STELLAR_SECRET_KEY) {
  // Use a dummy test keypair (not used in actual tests since they're mocked)
  process.env.STELLAR_SECRET_KEY = 'SBZVMB74Z76QZ3ZZY66NIDQCB5X5KZDQK4JQHJCZVDZ5XWFSM7K7HRE';
}
if (!process.env.VAULT_CONTRACT_ID) {
  process.env.VAULT_CONTRACT_ID = 'CBQHNAXSI55GX2WOOVEDW47GHQU2FWYKCFO4XWJWILTZLVNODAVZCXX';
}

// Suppress OpenTelemetry spam in test output
process.env.OTEL_LOG_LEVEL = 'error';

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
