import { defineConfig } from 'vitest/config';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.test.js'],
    exclude: hasTestDatabase ? [] : ['tests/api.*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['backend/**/*.js', 'server.js'],
      exclude: ['node_modules', 'tests', 'public']
    }
  },
});
