module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  forceExit: true,
  // Test files share a single on-disk SQLite database (prisma/dev.db).
  // Running suites in parallel workers lets writes from one file race
  // reads/writes in another against that shared file — e.g. two concurrent
  // getOrCreateReferralCode() calls for the same wallet racing past its
  // findFirst-then-create check. Serializing test files removes that
  // cross-process race entirely.
  maxWorkers: 1,
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 30000,
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    },
  },
  // Preload script to block problematic modules
  setupFiles: ['<rootDir>/src/__tests__/preload.js'],
  // Override module resolution to prevent @prisma/instrumentation from loading
  moduleNameMapper: {
    '^@yieldvault/api-schemas$': '<rootDir>/../packages/api-schemas/src/index.ts',
    '^@yieldvault/api-schemas/(.*)$': '<rootDir>/../packages/api-schemas/src/$1',
    '^@prisma/instrumentation$': '<rootDir>/src/__tests__/mocks/prismainstrumentation.js',
    '^@opentelemetry/(.*)$': '<rootDir>/src/__tests__/mocks/opentelemetry.js',
    // Redirect the sorobanClient module that vaultEndpoints imports (./sorobanClient)
    // so existing integration tests keep passing without a live Stellar RPC.
    // The sorobanClient unit test imports ../sorobanClient (different specifier)
    // and is therefore NOT redirected — it tests the real implementation.
    '^\\.\/sorobanClient$': '<rootDir>/src/__tests__/mocks/sorobanClient.js',
  },
};
