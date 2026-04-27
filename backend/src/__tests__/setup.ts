import dotenv from 'dotenv';

// Load environment variables for tests
dotenv.config({
  path: '.env.test',
  override: true,
});

// Set test environment
process.env.NODE_ENV = 'test';
process.env.OTEL_ENABLED = 'false';
process.env.STELLAR_RPC_URL = process.env.STELLAR_RPC_URL || 'http://localhost:8000/rpc';
