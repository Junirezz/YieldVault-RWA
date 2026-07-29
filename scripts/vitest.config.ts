import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environment: 'jsdom',
    include: ['scripts/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
});
