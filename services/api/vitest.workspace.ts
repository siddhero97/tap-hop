import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['test/unit/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.integration.config.ts',
    test: {
      name: 'integration',
      include: ['test/integration/**/*.test.ts'],
      fileParallelism: false,
      hookTimeout: 30000,
      testTimeout: 30000,
      poolOptions: {
        threads: {
          singleThread: true,
        },
      },
    },
  },
  {
    extends: './vitest.sandbox.config.ts',
    test: {
      name: 'sandbox',
      include: ['test/sandbox/**/*.test.ts'],
    },
  },
]);
