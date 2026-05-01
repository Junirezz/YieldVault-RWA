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
