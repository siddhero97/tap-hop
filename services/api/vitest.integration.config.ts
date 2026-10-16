import { defineConfig, configDefaults } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tabhop_test';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['test/integration-setup.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      PAYPAL_MODE: 'fake',
      LOG_LEVEL: 'error',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage/integration',
      exclude: [
        ...(configDefaults.coverage?.exclude ?? []),
        'src/server.ts',
        'src/app.ts',
        'src/config/env.ts',
        '**/*.config.*',
      ],
    },
  },
});
