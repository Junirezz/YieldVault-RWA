import dotenv from 'dotenv';

// Load environment variables for tests
dotenv.config({
  path: '.env.test',
  override: true,
});

// Set test environment
process.env.NODE_ENV = 'test';
